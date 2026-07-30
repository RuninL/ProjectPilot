import { createHashRouter } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { CalendarPage } from '@/features/calendar/pages/CalendarPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { GanttPage } from '@/features/gantt/pages/GanttPage';
import { MeetingDetailPage } from '@/features/meetings/pages/MeetingDetailPage';
import { MeetingsPage } from '@/features/meetings/pages/MeetingsPage';
import { PeoplePage } from '@/features/people/pages/PeoplePage';
import { PersonDetailPage } from '@/features/people/pages/PersonDetailPage';
import { ProjectDetailPage } from '@/features/projects/pages/ProjectDetailPage';
import { ProjectListPage } from '@/features/projects/pages/ProjectListPage';
import { RisksPage } from '@/features/risks/pages/RisksPage';
import { SettingsPage } from '@/features/settings/pages/SettingsPage';
import { MyTasksPage } from '@/features/tasks/pages/MyTasksPage';
import { TaskDetailPage } from '@/features/tasks/pages/TaskDetailPage';

/** Fixed route stack. Hash routing avoids custom-protocol deep-link issues in Tauri. */
export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'people', element: <PeoplePage /> },
      { path: 'people/:id', element: <PersonDetailPage /> },
      { path: 'projects', element: <ProjectListPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'risks', element: <RisksPage /> },
      { path: 'tasks', element: <MyTasksPage /> },
      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
      { path: 'gantt', element: <GanttPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'meetings', element: <MeetingsPage /> },
      { path: 'meetings/:meetingId', element: <MeetingDetailPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
