package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// newUpgrader creates a WebSocket upgrader whose origin check is driven entirely
// by the ALLOWED_WS_ORIGINS environment variable.
// Falls back to localhost origins for local development if the variable is not set.
func newUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			allowedOriginsEnv := strings.TrimSpace(os.Getenv("ALLOWED_WS_ORIGINS"))

			var allowedOrigins []string
			if allowedOriginsEnv == "" {
				// Local development fallback — never use in production without setting the env var.
				allowedOrigins = []string{
					"http://localhost:3000",
					"http://localhost:5173",
				}
			} else {
				for _, o := range strings.Split(allowedOriginsEnv, ",") {
					if trimmed := strings.TrimSpace(o); trimmed != "" {
						allowedOrigins = append(allowedOrigins, trimmed)
					}
				}
			}

			origin := r.Header.Get("Origin")
			if origin == "" {
				// Allow same-origin connections (no Origin header)
				return true
			}

			for _, allowed := range allowedOrigins {
				if allowed == origin {
					return true
				}
			}

			log.Printf("[WS] Origin rejected: %q (allowed: %v)", origin, allowedOrigins)
			return false
		},
		HandshakeTimeout: 10 * time.Second,
	}
}

var upgrader = newUpgrader()

// Client represents a connected WebSocket client.
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	id     string
	userID string
}

// Hub manages all active WebSocket connections.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.Mutex
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the Hub's event loop. All map mutations happen serially here.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("[WS] Client connected: %s | total: %d", client.id, h.ClientCount())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Printf("[WS] Client disconnected: %s | total: %d", client.id, h.ClientCount())

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Client send buffer full — drop and disconnect.
					delete(h.clients, client)
					close(client.send)
				}
			}
			h.mu.Unlock()
		}
	}
}

// BroadcastAlert serialises an alert and sends it to all connected clients.
func (h *Hub) BroadcastAlert(alert interface{}) {
	data, err := json.Marshal(alert)
	if err != nil {
		log.Printf("[WS] Failed to marshal alert: %v", err)
		return
	}
	data = append(data, '\n') // newline for proper message framing
	select {
	case h.broadcast <- data:
	default:
		log.Println("[WS] Broadcast channel full, dropping alert")
	}
}

// ClientCount returns the number of currently connected clients.
func (h *Hub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func ServeWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	if !websocket.IsWebSocketUpgrade(r) {
		http.Error(w, "Bad Request: expected websocket upgrade", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Failed to upgrade from %s: %v", r.RemoteAddr, err)
		return
	}

	clientID := uuid.New().String()[:8]
	client := &Client{
		hub:    hub,
		conn:   conn,
		send:   make(chan []byte, 256),
		id:     clientID,
		userID: "",
	}

	hub.register <- client
	log.Printf("[WS] Client registered: ID=%s | remote=%s", client.id, r.RemoteAddr)

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	c.conn.SetCloseHandler(func(code int, text string) error {
		log.Printf("[WS] Client %s close: code=%d reason=%s", c.id, code, text)
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WS] Unexpected close for client %s: %v", c.id, err)
			}
			break
		}
	}
}

func (c *Client) writePump() {
	// 52s interval keeps the connection alive through Render (55s), Railway (60s),
	// and Heroku (50s HTTP / 55s WS) proxy timeouts.
	ticker := time.NewTicker(52 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Flush any queued messages in the same write frame.
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
