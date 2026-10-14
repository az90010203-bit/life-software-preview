import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePrototype from './WorkspacePrototype';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspacePrototype />
  </StrictMode>,
);
