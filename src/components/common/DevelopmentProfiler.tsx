import { Profiler, type PropsWithChildren } from 'react';
import { recordPerformanceEvent } from '@/lib/performanceDiagnostics';

export function DevelopmentProfiler({ children }: PropsWithChildren) {
  if (!import.meta.env.DEV) return children;
  return (
    <Profiler
      id="ProjectPilot"
      onRender={(_id, phase, actualDuration) => {
        recordPerformanceEvent('react', `ProjectPilot:${phase}`, actualDuration);
      }}
    >
      {children}
    </Profiler>
  );
}
