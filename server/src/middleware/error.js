function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

/**
 * Turns thrown errors into JSON the client can show.
 *
 * v26: Mongoose cast/validation/duplicate errors were all reported as 500
 * "Server error" with a stack trace (stack was shown whenever NODE_ENV was
 * not exactly "production", which is the case on a Render service that never
 * set it). They now map to 400/409 with a readable message, and stack traces
 * are only logged on the server.
 */
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Server error';
  let details = err.details;

  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path === '_id' ? 'id' : err.path}: ${String(err.value).slice(0, 40)}`;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    details = Object.values(err.errors || {}).map((e) => e.message);
    message = details[0] || 'Some fields are invalid';
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || err.keyPattern || {}).filter((k) => k !== 'tenantId')[0];
    message = field ? `A record with this ${field} already exists` : 'This record already exists';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'The uploaded file is too large';
  }

  if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err.stack || err);
    if (process.env.NODE_ENV === 'production') message = 'Something went wrong on the server. Please try again.';
  }

  const payload = { message };
  if (details) payload.details = details;
  if (process.env.EXPOSE_ERROR_STACK === 'true' && err.stack) payload.stack = err.stack;
  res.status(statusCode).json(payload);
}

module.exports = { notFound, errorHandler };
