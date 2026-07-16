import React from 'react'
import { createRoot } from 'react-dom/client'
import WorkspaceShell from './workspaces/WorkspaceShell'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WorkspaceShell />
  </React.StrictMode>,
)
