// Max characters of a non-JSON response body echoed back in the error message — enough to identify
// a gateway/error page without dumping a full HTML document into the agent's context.
export const RESPONSE_BODY_SNIPPET_LENGTH = 200;

// Inclusive lower / exclusive upper bounds of the 2xx success range.
export const HTTP_OK = 200;
export const HTTP_MULTIPLE_CHOICES = 300;

export const OPEN_REVEAL_REQUESTS_PATH = '/api/v1/reveal/requests';
