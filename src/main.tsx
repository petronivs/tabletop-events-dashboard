import { createRoot } from 'react-dom/client';
import { createScheduleClient } from './api';
import { App } from './App';

const client = createScheduleClient();
const root = document.getElementById('root');
if (!root) throw new Error('App container unavailable.');
createRoot(root).render(<App client={client} />);
