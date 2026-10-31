// Synqora Centralized Dynamic System Configuration
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const CONFIG = {
  NODE_API_BASE: isLocal ? "http://localhost:5000/api" : "/api",
  NODE_SERVER_URL: isLocal ? "http://localhost:5000" : "",
  FASTAPI_BASE: isLocal ? "http://localhost:8000/api" : "/ai-api"
};

// Expose globally for both browser windows and module systems
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
