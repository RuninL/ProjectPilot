import { createHashRouter } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';

/** Fixed route stack. Hash routing avoids custom-protocol deep-link issues in Tauri. */
export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: <DashboardPage /> }],
  },
]);
