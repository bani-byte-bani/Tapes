import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// 通常のURL(/r/ABC123 など)を使うため BrowserRouter を採用。
// 深いURLを直接開いても404にならないよう public/_redirects で
// 「見つからないパスは index.html を返す」設定をしている。
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
