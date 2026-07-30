import { Copy, ExternalLink, File, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toAppError } from '@/lib/errors';
import { getProjectLinkService, isOpenableHttpUrl } from '@/services/projectLink.service';
import { getProjectService } from '@/services/project.service';
import type { ProjectLinkInput } from '@/services/schemas';
import type { LinkType, Project, ProjectLinkWithProject } from '@/types';
import { ProjectLinkForm } from '../components/ProjectLinkForm';

export function FilesPage() {
  const [links, setLinks] = useState<ProjectLinkWithProject[] | null>(null);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [linkType, setLinkType] = useState<LinkType | ''>('');
  const [formProjectId, setFormProjectId] = useState('');
  const [editing, setEditing] = useState<ProjectLinkWithProject | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectLinkWithProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [linkService, projectService] = await Promise.all([
        getProjectLinkService(),
        getProjectService(),
      ]);
      const [loadedLinks, loadedProjects] = await Promise.all([
        linkService.listAllProjectLinks({
          search,
          ...(projectId === '' ? {} : { projectId }),
          ...(linkType === '' ? {} : { linkType }),
        }),
        projectService.listProjects({ scope: 'all', sort: 'name' }),
      ]);
      setLinks(loadedLinks);
      setProjects(loadedProjects);
      setFormProjectId((current) => current || loadedProjects[0]?.id || '');
      setError(null);
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [linkType, projectId, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyTarget = async (link: ProjectLinkWithProject) => {
    try {
      await navigator.clipboard.writeText(link.target);
      setFeedback(link.link_type === 'url' ? '链接已复制。' : '路径已复制。');
    } catch (caught) {
      setError(`复制失败：${toAppError(caught).message}`);
    }
  };

  const openTarget = async (link: ProjectLinkWithProject) => {
    try {
      const service = await getProjectLinkService();
      await service.openProjectLink(link.project_id, link.id);
      setFeedback('已交给系统默认程序打开。');
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  };

  const save = async (input: ProjectLinkInput) => {
    const service = await getProjectLinkService();
    if (editing === null) {
      if (formProjectId === '') throw new Error('请先选择所属项目');
      await service.createProjectLink(formProjectId, input);
    } else {
      await service.updateProjectLink(editing.project_id, editing.id, input);
    }
    await load();
  };

  if (links === null && error === null) {
    return (
      <div className="p-6">
        <LoadingState label="正在加载文件…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">文件</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            汇总所有项目的网页链接与本地文件路径，不保存文件内容。
          </p>
        </div>
        <Button
          disabled={projects.length === 0}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新增文件或链接
        </Button>
      </header>

      <div className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="files-search">搜索名称或描述</Label>
          <Input
            id="files-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="files-project">所属项目</Label>
          <select
            id="files-project"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
            }}
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="files-type">类型</Label>
          <select
            id="files-type"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={linkType}
            onChange={(event) => {
              setLinkType(event.target.value as LinkType | '');
            }}
          >
            <option value="">全部类型</option>
            <option value="url">网页链接</option>
            <option value="file_path">本地路径</option>
          </select>
        </div>
      </div>

      {feedback !== null && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          {feedback}
        </p>
      )}
      {error !== null && links !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {links === null ? (
        <ErrorState
          title="无法加载文件"
          message={error ?? '读取失败'}
          onRetry={() => void load()}
        />
      ) : links.length === 0 ? (
        <EmptyState title="没有符合条件的文件" description="调整筛选条件，或新增文件与链接。" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {links.map((link) => {
            const canOpen = link.link_type === 'file_path' || isOpenableHttpUrl(link.target);
            return (
              <li key={link.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {link.link_type === 'url' ? (
                      <Link2 className="h-4 w-4" aria-hidden />
                    ) : (
                      <File className="h-4 w-4" aria-hidden />
                    )}
                    <span className="font-medium">{link.label}</span>
                    <Badge variant="outline">
                      {link.link_type === 'url' ? '网页链接' : '本地路径'}
                    </Badge>
                    <Link
                      className="text-sm text-primary hover:underline"
                      to={`/projects/${link.project_id}`}
                    >
                      {link.project_name}
                    </Link>
                  </div>
                  {link.description !== '' && (
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground" title={link.target}>
                    {link.target}
                  </p>
                  <p className="text-xs text-muted-foreground">创建时间：{link.created_at}</p>
                </div>
                <div className="flex gap-1">
                  {canOpen && (
                    <Button size="sm" variant="outline" onClick={() => void openTarget(link)}>
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      打开
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => void copyTarget(link)}>
                    <Copy className="h-4 w-4" aria-hidden />
                    复制
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`编辑：${link.label}`}
                    onClick={() => {
                      setEditing(link);
                      setFormProjectId(link.project_id);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除：${link.label}`}
                    onClick={() => {
                      setPendingDelete(link);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ProjectLinkForm
        open={formOpen}
        link={editing}
        projects={projects}
        projectId={formProjectId}
        onProjectIdChange={setFormProjectId}
        onSubmit={save}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除文件与链接"
        description={
          pendingDelete === null ? '' : `确定删除「${pendingDelete.label}」吗？此操作不可撤销。`
        }
        confirmLabel="删除"
        destructive
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={() => {
          const target = pendingDelete;
          if (target === null) return;
          void getProjectLinkService()
            .then((service) => service.deleteProjectLink(target.project_id, target.id))
            .then(async () => {
              setPendingDelete(null);
              await load();
            })
            .catch((caught: unknown) => {
              setError(toAppError(caught).message);
            });
        }}
      />
    </div>
  );
}
