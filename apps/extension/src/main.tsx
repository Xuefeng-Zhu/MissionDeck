import React from 'react';
import {createRoot} from 'react-dom/client';
import '@copilotkit/react-core/v2/styles.css';
import '@mission/ui/styles.css';
import App from './App';
import './upgrade.css';
import './missiondeck.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
