import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  closeDesktopWidget,
  desktopWidgetStatus,
  hideDesktopWidget,
  openDesktopWidget,
  setDesktopWidgetClickThrough,
  setDesktopWidgetLocked,
  showDesktopWidget,
  type DesktopWidgetStatus,
} from '@/lib/commands';
import { toAppError } from '@/lib/errors';
import { listenForDesktopWidgetState } from '@/features/settings/services/desktopWidgetEvents.service';

const WIDGET_STATE_EVENT = 'projectpilot:desktop-widget-state';

/** How long a status query may take before the UI reports failure instead of
 * loading forever. Widget state must never block the settings page. */
export const WIDGET_STATUS_TIMEOUT_MS = 5000;

function statusWithTimeout(): Promise<DesktopWidgetStatus> {
  return new Promise<DesktopWidgetStatus>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('读取桌面小窗状态超时，主程序不受影响，可点击“重新读取”重试。'));
    }, WIDGET_STATUS_TIMEOUT_MS);
    desktopWidgetStatus()
      .then((next) => {
        clearTimeout(timer);
        resolve(next);
      })
      .catch((caught: unknown) => {
        clearTimeout(timer);
        reject(caught instanceof Error ? caught : new Error(String(caught)));
      });
  });
}

/**
 * The 桌面小窗 settings area. There is no mode selector any more — WorkerW is
 * fully disabled — and the shown state always derives from the real window
 * (via `desktop_widget_status` and the Rust-side state event), never from a
 * persisted "running/starting" flag.
 */
export function DesktopWidgetSettingsSection() {
  const [status, setStatus] = useState<DesktopWidgetStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void statusWithTimeout()
      .then((next) => {
        setStatus(next);
      })
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
      });
  }, []);

  const retryStatus = useCallback(() => {
    setError(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listenForDesktopWidgetState((event) => {
      if (!disposed) setStatus(event.payload);
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((caught: unknown) => {
        if (!disposed) setError(toAppError(caught).message);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const run = useCallback(
    (action: () => Promise<void>) => {
      setError(null);
      setCopied(false);
      void action()
        .then(refresh)
        .catch((caught: unknown) => {
          setError(toAppError(caught).message);
          refresh();
        });
    },
    [refresh],
  );

  const open = useCallback(() => {
    if (starting) return;
    setStarting(true);
    setError(null);
    setCopied(false);
    void openDesktopWidget()
      .then(refresh)
      .catch((caught: unknown) => {
        setError(toAppError(caught).message);
        refresh();
      })
      .finally(() => {
        setStarting(false);
      });
  }, [refresh, starting]);

  const copyDiagnostics = useCallback(() => {
    const diagnostics = JSON.stringify(
      {
        error,
        status,
        userAgent: navigator.userAgent,
        time: new Date().toISOString(),
      },
      null,
      2,
    );
    void navigator.clipboard
      .writeText(diagnostics)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setCopied(false);
      });
  }, [error, status]);

  const stateLabel =
    status === null
      ? error === null
        ? '正在读取状态…'
        : '状态读取失败'
      : starting
        ? '启动中…'
        : !status.exists
          ? '未运行'
          : status.visible
            ? '正在显示'
            : '已隐藏';

  return (
    <section className="mb-6 rounded-lg border bg-card p-4" aria-labelledby="widget-heading">
      <h2 id="widget-heading" className="text-lg font-medium">
        桌面小窗
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        独立的无边框小窗，显示今日任务和日历（今天 /
        近七天）。可拖动、调整大小、隐藏和真正关闭；关闭小窗不影响主程序。
      </p>
      <p className="mt-2 text-sm" role="status">
        当前状态：<strong>{stateLabel}</strong>
        {status?.exists === true && status.locked && ' · 已锁定'}
        {status?.exists === true && status.click_through && ' · 点击穿透中'}
      </p>
      {error !== null && (
        <div className="mt-2 text-sm text-destructive" role="alert">
          {error}
          <span className="ml-2 inline-flex gap-2">
            <Button size="sm" variant="outline" onClick={status === null ? retryStatus : open}>
              {status === null ? '重新读取' : '重试'}
            </Button>
            <Button size="sm" variant="outline" onClick={copyDiagnostics}>
              {copied ? '已复制' : '复制诊断信息'}
            </Button>
          </span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {status !== null && !status.exists && (
          <Button onClick={open} disabled={starting}>
            {starting ? '正在打开…' : '打开桌面小窗'}
          </Button>
        )}
        {status?.exists === true && (
          <>
            {status.visible ? (
              <Button
                variant="outline"
                onClick={() => {
                  run(hideDesktopWidget);
                }}
              >
                隐藏
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  run(showDesktopWidget);
                }}
              >
                显示
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                run(closeDesktopWidget);
              }}
            >
              关闭
            </Button>
            {status.visible && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    run(() => setDesktopWidgetLocked(!status.locked));
                  }}
                >
                  {status.locked ? '解除位置锁定' : '锁定位置'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    run(() => setDesktopWidgetClickThrough(!status.click_through));
                  }}
                >
                  {status.click_through ? '关闭点击穿透' : '开启点击穿透'}
                </Button>
              </>
            )}
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        点击穿透开启后小窗不再响应鼠标，可随时从本页或托盘菜单恢复。锁定只禁止移动和缩放，内容仍可操作。
      </p>
    </section>
  );
}
