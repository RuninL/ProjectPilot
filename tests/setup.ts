import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom implements neither the Pointer Capture API nor scrollIntoView, both of
// which Radix's menu/dialog primitives call while managing focus.
Element.prototype.scrollIntoView = function scrollIntoView() {
  /* no-op */
};
Element.prototype.hasPointerCapture = function hasPointerCapture() {
  return false;
};
Element.prototype.releasePointerCapture = function releasePointerCapture() {
  /* no-op */
};

afterEach(() => {
  cleanup();
});
