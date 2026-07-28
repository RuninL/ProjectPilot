import { createHashRouter } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { CalendarPage } from '@/features/calendar/pages/CalendarPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { MeetingsPage } from '@/features/meetings/pages/MeetingsPage';
import { ProjectsPage } from '@/features/projects/pages/ProjectsPage';
import { SettingsPage } from '@/features/settings/pages/SettingsPage';
import { MyTasksPage } from '@/features/tasks/pages/MyTasksPage';

/** Fixed route stack. Hash routing avoids custom-protocol deep-link issues in Tauri. */
export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'tasks', element: <MyTasksPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'meetings', element: <MeetingsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
