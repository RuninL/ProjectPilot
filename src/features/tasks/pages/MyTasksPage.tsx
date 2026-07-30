import { TaskWorkspace } from '../components/TaskWorkspace';

/** Cross-project task list: tasks from every project, filterable and bulk-editable. */
export function MyTasksPage() {
  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">任务</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          跨项目查看任务。新建任务时需要选择一个未归档的项目。
        </p>
      </header>
      <TaskWorkspace projectId={null} canCreate createHint={null} />
    </div>
  );
}
