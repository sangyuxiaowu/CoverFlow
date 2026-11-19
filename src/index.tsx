// 模块：应用挂载入口
import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureBackgroundRemovalStorage } from 'sang-ai-kit';
import App from './App.tsx';
import './index.css';

configureBackgroundRemovalStorage({ databaseName: 'coverflow-background-removal' });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
