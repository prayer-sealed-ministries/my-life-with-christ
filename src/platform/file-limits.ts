/**
 * Hard ceiling before a chosen file crosses into application memory.
 *
 * Native pickers base64-encode bytes across the WebView bridge and browsers
 * materialise File.arrayBuffer(), so refusing only after either operation is
 * too late to prevent resource exhaustion. Sixty-four MiB is intentionally
 * generous for text journals while remaining bounded on supported phones.
 */
export const MAX_PICKED_FILE_BYTES = 64 * 1024 * 1024;

export const pickedFileTooLargeMessage =
  'That file is larger than the 64MB import limit and was not read.';
