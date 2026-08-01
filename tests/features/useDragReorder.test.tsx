import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { useDragReorder } from '@/features/sorting/useDragReorder';
import { moveIdToTarget } from '@/features/sorting/useSavedListOrder';

/**
 * The shared pointer-based drag infrastructure, exercised through real DOM
 * events on a real list: pointer down on the handle, movement threshold,
 * over-row hit-testing, one commit per drop, Escape cancel and scope
 * isolation between two lists on the same page.
 */

function Sortable({
  prefix,
  initial,
  onCommit,
  disabled = false,
}: {
  prefix: string;
  initial: readonly string[];
  onCommit: Mock;
  disabled?: boolean;
}) {
  const [ids, setIds] = useState([...initial]);
  const drag = useDragReorder((sourceId, targetId) => {
    onCommit(sourceId, targetId);
    setIds((previous) => moveIdToTarget(previous, sourceId, targetId));
  }, disabled);
  return (
    <ul aria-label={`${prefix} 列表`}>
      {ids.map((id) => (
        <li
          key={id}
          {...drag.dropProps(id)}
          data-testid={`${prefix}-row-${id}`}
          className={`${drag.dropTargetId === id ? 'is-target' : ''} ${
            drag.activeId === id ? 'is-source' : ''
          }`}
        >
          <span aria-label={`拖动排序 ${prefix}-${id}`} {...drag.handleProps(id)} />
          <button type="button" aria-label={`行内按钮 ${prefix}-${id}`} />
          {id}
        </li>
      ))}
    </ul>
  );
}

function rowTexts(prefix: string): string[] {
  return screen
    .getAllByTestId(new RegExp(`^${prefix}-row-`))
    .map((row) => row.textContent ?? '');
}

function drag(prefix: string, sourceId: string, targetId: string) {
  const handle = screen.getByLabelText(`拖动排序 ${prefix}-${sourceId}`);
  const target = screen.getByTestId(`${prefix}-row-${targetId}`);
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 100 });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 100 });
}

describe('useDragReorder', () => {
  it('drags the first row directly onto the third and commits exactly once', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} />);

    const handle = screen.getByLabelText('拖动排序 l-A');
    const target = screen.getByTestId('l-row-C');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 90 });
    // Feedback while hovering: the target ring and the dimmed source row.
    expect(target).toHaveClass('is-target');
    expect(screen.getByTestId('l-row-A')).toHaveClass('is-source');
    // Nothing is committed while the pointer is still moving.
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 90 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('A', 'C');
    expect(rowTexts('l')).toEqual(['B', 'C', 'A']);
  });

  it('drags the last row directly onto the first (upwards across several rows)', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C', 'D']} onCommit={onCommit} />);

    drag('l', 'D', 'A');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(rowTexts('l')).toEqual(['D', 'A', 'B', 'C']);
  });

  it('does not activate below the movement threshold, so plain clicks never reorder', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} />);

    const handle = screen.getByLabelText('拖动排序 l-A');
    const target = screen.getByTestId('l-row-C');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 1, clientY: 2 });
    expect(target).not.toHaveClass('is-target');
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 1, clientY: 2 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(rowTexts('l')).toEqual(['A', 'B', 'C']);
  });

  it('dropping a row back on itself writes nothing', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} />);

    drag('l', 'B', 'B');

    expect(onCommit).not.toHaveBeenCalled();
    expect(rowTexts('l')).toEqual(['A', 'B', 'C']);
  });

  it('Escape cancels an active drag without committing', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} />);

    const handle = screen.getByLabelText('拖动排序 l-A');
    const target = screen.getByTestId('l-row-C');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 90 });
    expect(target).toHaveClass('is-target');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(target).not.toHaveClass('is-target');
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 90 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(rowTexts('l')).toEqual(['A', 'B', 'C']);
  });

  it('inline buttons inside the row never start a drag', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} />);

    const button = screen.getByLabelText('行内按钮 l-A');
    const target = screen.getByTestId('l-row-C');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 90 });
    expect(target).not.toHaveClass('is-target');
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 90 });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('the right mouse button never starts a drag', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} />);

    const handle = screen.getByLabelText('拖动排序 l-A');
    const target = screen.getByTestId('l-row-C');
    fireEvent.pointerDown(handle, {
      button: 2,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 0, clientY: 90 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 0, clientY: 90 });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const onCommit = vi.fn();
    render(<Sortable prefix="l" initial={['A', 'B', 'C']} onCommit={onCommit} disabled />);

    drag('l', 'A', 'C');

    expect(onCommit).not.toHaveBeenCalled();
    expect(rowTexts('l')).toEqual(['A', 'B', 'C']);
  });

  it('two lists on the same page stay isolated: a drag never drops into the other list', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <Sortable prefix="one" initial={['A', 'B']} onCommit={first} />
        <Sortable prefix="two" initial={['X', 'Y']} onCommit={second} />
      </>,
    );

    const handle = screen.getByLabelText('拖动排序 one-A');
    const foreign = screen.getByTestId('two-row-Y');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(foreign, { pointerId: 1, clientX: 0, clientY: 200 });
    expect(foreign).not.toHaveClass('is-target');
    fireEvent.pointerUp(foreign, { pointerId: 1, clientX: 0, clientY: 200 });

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(rowTexts('one')).toEqual(['A', 'B']);
    expect(rowTexts('two')).toEqual(['X', 'Y']);
  });
});
