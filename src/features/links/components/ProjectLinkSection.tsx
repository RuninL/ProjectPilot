import { Copy, ExternalLink, File, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingState } from '@/components/common/LoadingState';
import { SampleBadge } from '@/components/common/SampleBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toAppError } from '@/lib/errors';
import {
  getProjectLinkService,
  isOpenableHttpUrl,
} from '@/services/projectLink.service';
import type { ProjectLinkInput } from '@/services/schemas';
import type { Project, ProjectLink } from '@/types';
import { ProjectLinkForm } from './ProjectLinkForm';

interface ProjectLinkSectionProps {
  project: Project;
}

export function ProjectLinkSection({ project }: ProjectLinkSectionProps) {
  const [links, setLinks] = useState<ProjectLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectLink | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const service = await getProjectLinkService();
      setLinks(await service.listProjectLinks(project.id));
    } catch (caught) {
      setError(toAppError(caught).message);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyTarget = async (link: ProjectLink): Promise<void> => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(link.target);
      setFeedback(link.link_type === 'url' ? '链接已复制到剪贴板。' : '路径已复制到剪贴板。');
    } catch (caught) {
      setFeedback(null);
      setActionError(`复制失败：${toAppError(caught).message}`);
    }
  };

  const openTarget = async (link: ProjectLink): Promise<void> => {
    setActionError(null);
    setFeedback(null);
    setBusy(true);
    try {
      const service = await getProjectLinkService();
      await service.openProjectLink(project.id, link.id);
      setFeedback('已交给系统默认程序打开。');
    } catch (caught) {
      setActionError(toAppError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteLink = (): void => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) return;
    setActionError(null);
    setFeedback(null);
    setBusy(true);
    void getProjectLinkService()
      .then((service) => service.deleteProjectLink(project.id, target.id))
      .then(load)
      .catch((caught: unknown) => {
        setActionError(toAppError(caught).message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const saveLink = async (input: ProjectLinkInput): Promise<void> => {
    const service = await getProjectLinkService();
    if (editing === null) {
      await service.createProjectLink(project.id, input);
    } else {
      await service.updateProjectLink(project.id, editing.id, input);
    }
    await load();
  };

  if (links === null && error === null) {
    return <LoadingState label="正在加载文件与链接…" />;
  }
  if (links === null) {
    return (
      <ErrorState
        title="无法加载文件与链接"
        message={error ?? '无法读取项目资料'}
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  const addButton = (
    <Button
      size="sm"
      onClick={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <Plus className="h-4 w-4" aria-hidden />
      新增链接
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          仅保存 URL 或本机路径，不保存文件内容。本地文件移动或删除后路径会失效，但仍可复制。
        </p>
        {links.length > 0 && addButton}
      </div>

      {feedback !== null && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
          {feedback}
        </p>
      )}
      {actionError !== null && (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}

      {links.length === 0 ? (
        <EmptyState
          title="暂无文件与链接"
          description="可添加项目资料、网页链接或本地文件快捷方式。"
          action={addButton}
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {links.map((link) => {
            const canOpen =
              link.link_type === 'file_path' ? true : isOpenableHttpUrl(link.target);
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {link.link_type === 'url' ? (
                      <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                    <span className="font-medium">{link.label}</span>
                    <Badge variant="outline">
                      {link.link_type === 'url' ? '网页链接' : '本地路径'}
                    </Badge>
                    {link.is_sample === 1 && <SampleBadge />}
                  </div>
                  <p className="max-w-3xl truncate text-sm text-muted-foreground" title={link.target}>
                    {link.target}
                  </p>
                  {link.description !== '' && (
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">更新时间：{link.updated_at}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {canOpen && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        void openTarget(link);
                      }}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      打开
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void copyTarget(link);
                    }}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    复制
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`编辑文件与链接：${link.label}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(link);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`删除文件与链接：${link.label}`}
                    disabled={busy}
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
        onSubmit={saveLink}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除文件与链接"
        description={
          pendingDelete === null
            ? ''
            : `确定删除「${pendingDelete.label}」吗？所属项目：${project.name}。此操作不可撤销。`
        }
        confirmLabel="删除"
        destructive
        busy={busy}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={deleteLink}
      />
    </div>
  );
}
