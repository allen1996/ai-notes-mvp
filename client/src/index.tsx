import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@client/App.tsx";
import "@client/styles/app.css";
import "@client/styles/auth.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
