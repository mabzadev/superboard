import OpenGrowContext from "./opengrow_context";

/**
 * Helper class for making API requests to OpenGrow service.
 */
class OpenGrowAPIServiceHelper {

  /**
   * Constructor for OpenGrowAPIServiceHelper.
   * @param {string} APIKey - API key for accessing the OpenGrow API.
   */
  constructor(APIKey) {
    this.APIKey = APIKey;
  }

  /**
   * Perform a POST request to the OpenGrow API.
   * @param {string} path - API endpoint path.
   * @param {Object} data - Data to be sent in the request body.
   * @param {Function} success - Success callback function.
   * @param {Function} error - Error callback function.
   */
  POST(path, data, success, error) {
    const headers = this.buildHeaders();
    const endpoint = this.endpoint(path);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);

    // Set request headers
    for (const key in headers) {
      xhr.setRequestHeader(key, headers[key]);
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = xhr.responseText;
          success(JSON.parse(response));
        } else {
          error(xhr.statusText);
        }
      }
    };

    xhr.send(JSON.stringify(data));
  }

  GET(path, data, success, error) {
    const headers = this.buildHeaders();
    const endpoint = this.endpoint(path);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", endpoint, true);

    // Set request headers
    for (const key in headers) {
      xhr.setRequestHeader(key, headers[key]);
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = xhr.responseText;
          success(JSON.parse(response));
        } else {
          error(xhr.statusText);
        }
      }
    };

    xhr.send(JSON.stringify(data));
  }

  endpoint(path) {
    if (!OpenGrowContext.API_BASE_URL) {
      throw new Error("OpenGrow baseURL is not configured");
    }
    return OpenGrowContext.API_BASE_URL + path;
  }

  /**
   * Build request headers for the API request.
   * @returns {Object} - Request headers.
   */
  buildHeaders() {
    const headers = {};
    headers["Content-Type"] = "application/json";
    headers["PLATFORM"] = "web";

    // Get identifier
    const { protocol, hostname, port } = window.location;
    const portPart = port ? `:${port}` : "";
    const fullURL = `${protocol}//${hostname}${portPart}`;

    // Add domain identifier header
    if (window && window.location) {
      headers["IDENTIFIER"] = fullURL;
    }

    // Add OpenGrow ID header
    if (OpenGrowContext.linksquaredID) {
      headers["linksquared"] = OpenGrowContext.linksquaredID;
    }

    // Add API key header
    if (OpenGrowContext.API_KEY) {
      if (OpenGrowContext.testEnvironment) {
        headers["PROJECT_KEY"] = "test_" + OpenGrowContext.API_KEY;
      } else {
        headers["PROJECT_KEY"] = OpenGrowContext.API_KEY;
      }
    }

    return headers;
  }
}

export default OpenGrowAPIServiceHelper;
