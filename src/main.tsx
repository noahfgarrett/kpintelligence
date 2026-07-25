import React from 'react'
import { createRoot } from 'react-dom/client'
import KPIntelligenceShell from './studio/shell/KPIntelligenceShell'
import './styles.css'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './studio/studio.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <KPIntelligenceShell />
  </React.StrictMode>,
)
