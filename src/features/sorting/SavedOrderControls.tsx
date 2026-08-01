import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SavedListOrderController } from './useSavedListOrder';

interface SavedOrderControlsProps<T extends { id: string }> {
  controller: SavedListOrderController<T>;
  disabledReason: string | null;
}

export function SavedOrderControls<T extends { id: string }>({
  controller,
  disabledReason,
}: SavedOrderControlsProps<T>) {
  const [dialog, setDialog] = useState<'save' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const manual = controller.mode !== 'dynamic';

  const submit = async () => {
    if (dialog === 'save') await controller.save(name, isDefault);
    if (dialog === 'rename') await controller.rename(name);
    setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="saved-order">自定义排序</Label>
      <select
        id="saved-order"
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={controller.mode}
        onChange={(event) => {
          controller.selectMode(event.target.value as typeof controller.mode);
        }}
      >
        <option value="dynamic">页面原有默认排序</option>
        <option value="custom">自定义排序</option>
        {controller.orders.map((order) => (
          <option key={order.id} value={`saved:${order.id}`}>
            {order.name}
            {order.is_default === 1 ? '（默认）' : ''}
          </option>
        ))}
      </select>
      {manual && (
        <>
          <Button
            variant="outline"
            disabled={disabledReason !== null}
            onClick={() => {
              setName('');
              setIsDefault(false);
              setDialog('save');
            }}
          >
            保存当前排序
          </Button>
          {controller.selectedOrder !== undefined && (
            <>
              <Button variant="outline" onClick={() => void controller.overwrite()}>
                覆盖保存
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setName(controller.selectedOrder?.name ?? '');
                  setDialog('rename');
                }}
              >
                重命名
              </Button>
              <Button variant="outline" onClick={() => void controller.remove()}>
                删除
              </Button>
            </>
          )}
        </>
      )}
      {disabledReason !== null && manual && (
        <span className="text-sm text-muted-foreground">{disabledReason}</span>
      )}
      {controller.error !== null && (
        <span className="text-sm text-destructive">{controller.error}</span>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'rename' ? '重命名排序' : '保存当前排序'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="order-name">排序名称</Label>
            <Input
              id="order-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            {dialog === 'save' && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(event) => {
                    setIsDefault(event.target.checked);
                  }}
                />
                设为该列表默认自定义顺序
              </label>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
              }}
            >
              取消
            </Button>
            <Button disabled={name.trim() === ''} onClick={() => void submit()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
