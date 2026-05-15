import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { loadWebEnv } from "./env";
import "./styles.css";

const queryClient = new QueryClient();
const root = ReactDOM.createRoot(document.getElementById("root")!);

try {
  loadWebEnv();

  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
} catch (error) {
  root.render(
    <div style={{ color: "#fca5a5", padding: "2rem", fontFamily: "monospace" }}>
      {error instanceof Error ? error.message : "Invalid web environment variables"}
    </div>,
  );
}
