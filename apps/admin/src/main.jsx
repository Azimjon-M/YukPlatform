import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary } from "./ErrorScreen.jsx";
import { installGlobalHandlers } from "./errors.js";
import "./styles.css";

// Tugma bosilganda, setTimeout yoki Promise'da chiqqan xatolar ham «Xatolar» bo'limiga tushsin
installGlobalHandlers();

// Tashqi ErrorBoundary — butun ilova (menyu ham) yiqilsa ham oq ekran emas, xato sahifasi
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary standalone>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
