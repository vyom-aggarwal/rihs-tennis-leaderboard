import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewHarness } from './design/PreviewHarness';
import './design/harness.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewHarness />
  </StrictMode>,
);
