import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CompanionApp() {
  const [view, setView] = useState<'today' | 'calendar'>('today');
  return (
    <main className="min-h-screen overflow-x-hidden bg-background p-4 text-foreground">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">ProjectPilot</h1>
          <p className="text-sm text-muted-foreground">Companion</p>
        </div>
        <Button size="sm" variant="outline" aria-label="Open main ProjectPilot window">
          Open main
        </Button>
      </header>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Companion view">
        <Button
          size="sm"
          role="tab"
          aria-selected={view === 'today'}
          variant={view === 'today' ? 'default' : 'outline'}
          onClick={() => setView('today')}
        >
          Today tasks
        </Button>
        <Button
          size="sm"
          role="tab"
          aria-selected={view === 'calendar'}
          variant={view === 'calendar' ? 'default' : 'outline'}
          onClick={() => setView('calendar')}
        >
          Calendar
        </Button>
      </div>
      {view === 'today' ? (
        <section className="mt-4 rounded-lg border p-4" role="tabpanel">
          <h2 className="font-medium">Today</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Loading today’s meetings, due tasks, milestones, and overdue work.
          </p>
        </section>
      ) : (
        <section className="mt-4 rounded-lg border p-4" role="tabpanel">
          <h2 className="font-medium">Calendar</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Select a date to view its local ProjectPilot schedule.
          </p>
        </section>
      )}
    </main>
  );
}
