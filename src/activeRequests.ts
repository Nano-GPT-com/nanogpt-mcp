/**
 * Global registry for active HTTP requests
 *
 * Tracks AbortControllers for all in-flight HTTP requests to enable
 * graceful shutdown - aborting pending requests when the server stops.
 */

/** Set of active AbortControllers for in-flight HTTP requests */
const activeRequests = new Set<AbortController>();

/**
 * Register an AbortController for tracking.
 * Call this before starting an HTTP request.
 */
export function registerRequest(controller: AbortController): void {
  activeRequests.add(controller);
}

/**
 * Unregister an AbortController after request completes.
 * Call this in a finally block after the HTTP request.
 */
export function unregisterRequest(controller: AbortController): void {
  activeRequests.delete(controller);
}

/**
 * Abort all active requests and clear the registry.
 * Call this during graceful shutdown.
 */
export function abortAllRequests(): void {
  for (const controller of activeRequests) {
    controller.abort();
  }
  activeRequests.clear();
}

/**
 * Get the count of active requests (for debugging/logging).
 */
export function getActiveRequestCount(): number {
  return activeRequests.size;
}
