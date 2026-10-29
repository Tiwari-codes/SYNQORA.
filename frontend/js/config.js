// Synqora Centralized System Configuration
const CONFIG = {
  NODE_API_BASE: "http://localhost:5000/api",
  NODE_SERVER_URL: "http://localhost:5000",
  FASTAPI_BASE: "http://localhost:8000/api"
};

// Expose globally for both browser windows and module systems if needed
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

