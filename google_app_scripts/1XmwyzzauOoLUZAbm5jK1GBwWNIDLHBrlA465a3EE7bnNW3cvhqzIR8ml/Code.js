const creds = getCredentials();
const TELEGRAM_CHAT_ID = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '-1002190388985';
const TELEGRAM_API_TOKEN = creds.TELEGRAM_API_TOKEN || '8344194076:AAGSKIKt9yzCGJvxw5DObhfvWRmOp_3b6Jg';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_API_TOKEN}`;

/**
 * Web app POST handler
 */
function doPost(e) {
  try {
    Logger.log("doPost triggered at: " + new Date().toISOString());
    Logger.log("Full event object: " + JSON.stringify(e, null, 2));

    // Check if event object exists
    if (!e) {
      Logger.log("No event object received");
      const errorResponse = {
        status: 'error',
        error: 'No event object received in the request'
      };
      return ContentService.createTextOutput(JSON.stringify(errorResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Log all possible event properties
    Logger.log("Event properties: postData=" + (e.postData ? JSON.stringify(e.postData) : 'undefined') + 
              ", parameter=" + JSON.stringify(e.parameter) +
              ", contentLength=" + e.contentLength);

    // Check for postData and contents
    if (!e.postData || !e.postData.contents || !e.postData.type) {
      Logger.log("Invalid or missing postData. postData=" + (e.postData ? JSON.stringify(e.postData) : 'undefined'));
      if (e.parameter && e.parameter.text) {
        Logger.log("Found text in e.parameter, processing as fallback");
        sendMessageToTelegram(e.parameter.text);
        const response = {
          status: 'success',
          textSent: true,
          fileSent: false
        };
        return ContentService.createTextOutput(JSON.stringify(response))
          .setMimeType(ContentService.MimeType.JSON);
      }
      const errorResponse = {
        status: 'error',
        error: 'No valid postData or parameters received in the request'
      };
      return ContentService.createTextOutput(JSON.stringify(errorResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = e.postData;
    const contentType = data.type || 'application/octet-stream';
    Logger.log("Content-Type: " + contentType);

    let fileSent = false;
    let textSent = false;

    if (contentType.includes('multipart/form-data')) {
      const parts = parseMultipart(data.contents, contentType);
      Logger.log("Parsed parts: " + JSON.stringify(parts, null, 2));

      let textBody = '';
      let fileBlob = null;

      for (let part of parts) {
        Logger.log("Processing part: name=" + part.name + ", filename=" + part.filename + ", contentType=" + part.contentType);
        if (part.name === 'text') {
          textBody += part.blob.getDataAsString();
        } else if (part.name === 'attachment' && part.filename) {
          fileBlob = part.blob;
          Logger.log("File blob detected: filename=" + part.filename + ", size=" + fileBlob.getBytes().length);
        }
      }

      if (fileBlob) {
        Logger.log("Sending file to Telegram: " + fileBlob.getName());
        sendFileToTelegram(fileBlob);
        fileSent = true;
      } else {
        Logger.log("No valid file blob found for attachment");
      }

      if (textBody.trim()) {
        Logger.log("Sending text to Telegram: " + textBody.substring(0, 500));
        sendMessageToTelegram(textBody);
        textSent = true;
      }
    } else {
      Logger.log("Non-multipart content received");
      const bodyText = data.contents;
      if (bodyText) {
        Logger.log("Sending text to Telegram: " + bodyText.substring(0, 500));
        sendMessageToTelegram(bodyText);
        textSent = true;
      } else {
        Logger.log("No content to send");
      }
    }

    const response = {
      status: 'success',
      fileSent: fileSent,
      textSent: textSent
    };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log("Error in doPost: " + err.stack);
    const errorResponse = {
      status: 'error',
      error: err.message
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Upload a file to Telegram
 */
function sendFileToTelegram(blob) {
  try {
    const formData = {
      chat_id: TELEGRAM_CHAT_ID,
      document: blob
    };

    const options = {
      method: 'post',
      payload: formData,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(`${TELEGRAM_API_URL}/sendDocument`, options);
    Logger.log("Telegram sendDocument response: " + response.getContentText());
    if (response.getResponseCode() !== 200) {
      throw new Error("Failed to send file to Telegram: " + response.getContentText());
    }
  } catch (err) {
    Logger.log("Error in sendFileToTelegram: " + err.stack);
    throw err;
  }
}

/**
 * Send a text message to Telegram
 */
function sendMessageToTelegram(text) {
  try {
    const payload = {
      chat_id: TELEGRAM_CHAT_ID,
      text: text
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(`${TELEGRAM_API_URL}/sendMessage`, options);
    Logger.log("Telegram sendMessage response: " + response.getContentText());
    if (response.getResponseCode() !== 200) {
      throw new Error("Failed to send message to Telegram: " + response.getContentText());
    }
  } catch (err) {
    Logger.log("Error in sendMessageToTelegram: " + err.stack);
    throw err;
  }
}

function parseMultipart(contents, contentType) {
  try {
    Logger.log("Raw contents (first 500 chars): " + contents.substring(0, 500));
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
    if (!boundaryMatch) {
      Logger.log("No boundary found in Content-Type: " + contentType);
      return [];
    }
    const boundary = boundaryMatch[1];
    Logger.log("Boundary: " + boundary);

    const parts = contents.split(`--${boundary}`);
    const parsed = [];

    for (let part of parts) {
      part = part.trim();
      if (part === '' || part === '--') continue;

      const headersEnd = part.indexOf('\r\n\r\n');
      if (headersEnd === -1) {
        Logger.log("No headers found in part: " + part.substring(0, 100));
        continue;
      }

      const headers = part.substring(0, headersEnd);
      let body = part.substring(headersEnd + 4);
      body = body.replace(/--\r\n$/, '').trim();

      const filenameMatch = headers.match(/filename="(.+?)"/);
      const nameMatch = headers.match(/name="(.+?)"/);
      const contentTypeMatch = headers.match(/Content-Type: (.+)/i);

      const filename = filenameMatch ? filenameMatch[1] : null;
      const name = nameMatch ? nameMatch[1] : null;
      const partContentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';

      let blob;
      try {
        if (filename) {
          // For files, convert body to bytes directly
          const bytes = Utilities.newBlob(body).getBytes();
          blob = Utilities.newBlob(bytes, partContentType, filename);
        } else {
          // For text parts, use string directly
          blob = Utilities.newBlob(body, partContentType, name || 'unnamed');
        }
        Logger.log("Blob created: name=" + name + ", filename=" + filename + ", size=" + blob.getBytes().length);
      } catch (err) {
        Logger.log("Error creating blob for part: name=" + name + ", error=" + err.message);
        continue;
      }

      parsed.push({
        filename: filename,
        name: name,
        contentType: partContentType,
        blob: blob
      });
    }

    Logger.log("Parsed parts: " + JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (err) {
    Logger.log("Error in parseMultipart: " + err.stack);
    return [];
  }
}

/**
 * Test sending message and file to Telegram
 */
function testSendToTelegram() {
  const testText = "🔧 Test message from Google Apps Script at " + new Date().toISOString();
  const testFile = Utilities.newBlob("This is a test file content", 'text/plain', 'testfile.txt');

  try {
    sendMessageToTelegram(testText);
    sendFileToTelegram(testFile);
    Logger.log("Test message and file sent successfully.");
  } catch (err) {
    Logger.log("Test failed: " + err.message);
  }
}

/**
 * Placeholder for getCredentials function
 * Replace with actual implementation
 */
function getCredentials() {
  // Replace with actual credential retrieval logic
  return {
    TELEGRAM_API_TOKEN: PropertiesService.getScriptProperties().getProperty('TELEGRAM_API_TOKEN') || '8344194076:AAGSKIKt9yzCGJvxw5DObhfvWRmOp_3b6Jg'
  };
}