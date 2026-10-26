// An error that carries an HTTP status code and a message that is safe to show the user.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
