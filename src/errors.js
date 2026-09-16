/** The model provider failed (transport, HTTP error, refusal, truncation). Never retried blindly. */
export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    /** @type {number | undefined} */
    this.status = options.status;
  }
}

/** A step kept producing output that the validator rejected. */
export class StepFailedError extends Error {
  /**
   * @param {string} stepId
   * @param {string[][]} attemptErrors One list of validation errors per rejected attempt.
   */
  constructor(stepId, attemptErrors) {
    const last = attemptErrors.at(-1) ?? [];
    super(
      `[${stepId}] output rejected after ${attemptErrors.length} attempt(s): ${last.slice(0, 3).join('; ')}`,
    );
    this.name = 'StepFailedError';
    this.stepId = stepId;
    this.attemptErrors = attemptErrors;
  }
}

/** Invalid CLI arguments or client data. Raised before any model call. */
export class InputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}
