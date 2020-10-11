/**
  * Sample inbound integration showing how to use jambonz
  * with Symbl's websocket API as the inbound audio stream
  */

/* import necessary modules for the web-socket API */
const env = require('dotenv').config();
const WebSocket = require("ws");
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const ws = new WebSocket.Server({ server });
const WebSocketClient = require("websocket").client; 
const wsc = new WebSocketClient();
const request = require('request');
const uuidv4 = require('uuid').v4;

/* Initalize connection handlers */
const meetingId = uuidv4();
let connection = undefined;
let client_connection = undefined;
let callSid = undefined;
let lastResponse = undefined;
let joinRequested = undefined;
let accessToken = undefined;

/* Handle Connection Error */
ws.on('connectFailed', (e) => {
  console.error('Connection Failed.', e);
});

/* Handle Web Socket Connection */
ws.on('connection', (conn) => {

  connection = conn;

  connection.on('error', (err) => {
    console.log('WebSocket error.', err)
  });

  connection.on('message', (data) => {  
    if (typeof data === 'string') {
      console.log(`received message: ${data}`);
    }
    else if (data instanceof Buffer) {
      if(client_connection) {
        let buff = Buffer.from(data, 'base64'); // Convert audio to base64
        client_connection.send(buff);
      }
    }
  });

  connection.on('close', () => {
    console.log('We were dropped from conference bridge');
    client_connection.send(JSON.stringify({type: 'stop_request'}));
  });
  
  /* Content Payload */
  client_connection.send(JSON.stringify({
    type: 'start_request',
    insightTypes: ['question', 'action_item'],
    config: {
      confidenceThreshold: 0.5,
      timezoneOffset: 240, // Your timezone offset from UTC in minutes
      languageCode: 'en-US',
      speechRecognition: {
        encoding: 'LINEAR16', 
        sampleRateHertz: 8000 
      },
      meetingTitle: 'Team meeting'
    },
    speaker: {
      userId: 'daveh@drachtio.org',
      name: 'daveh'
    },
  }));
});

/* Generate Auth Token */
const authOptions = {
  method: 'post',
  url: 'https://api.symbl.ai/oauth2/token:generate',
  body: {
    type: 'application',
    appId: process.env.APP_ID,
    appSecret: process.env.APP_SECRET
  },
  json: true
};

const auth = new Promise(resolve => {
  request(authOptions, (err, res, body) => {
    if (err) {
      console.error('error posting json: ', err);
      throw err;
    }
    resolve(body);
  })
});

/* Connect to Symbl's Websocket API */
auth.then(body => {
  accessToken = body.accessToken;
  const url = `wss://api.symbl.ai/v1/realtime/insights/${meetingId}`;
  //console.log(`connecting to symbold with url ${url}`);
  wsc.connect(
    url,
    null,
    null,
    { 'X-API-KEY': body.accessToken}
  );
});

/* Websocket Client Connection */
wsc.on('connectFailed', (err) => {
  console.log(err, 'failed to connect');
});
wsc.on("connect", (conn) => {
  console.log('successfully connected to symbold');
  client_connection = conn;

  client_connection.on('close', () => {
    console.log('WebSocket closed.');
    process.exit(0);
  });

  client_connection.on('error', (err) => {
    console.log('WebSocket error.', err)
  });

  client_connection.on('message', (data) => {
    if(data.type === 'utf8'){
      const { utf8Data } = data;
      processSymboldAi(utf8Data);
    }
  });

  dialIntoMeeting();
});

const processSymboldAi = (data) => {
  //console.log(`data: ${data}`);

  try {
    const obj = JSON.parse(data);
    if (obj.type === 'message_response') {
      const text = obj.messages
        .filter((m) => m.payload.contentType === 'text/plain')
        .map((m) => m.payload.content)
        .join(' ');
      console.log(`got message: ${text}`);
    }
    else if (obj.type === 'message' && obj.message.type === 'recognition_result' && obj.message.isFinal) {
      const transcript = obj.message.payload.raw.alternatives[0].transcript
      console.log(`got final transcript: ${transcript}`);

      const join = /[Hh]ey.*(bones|Barnes|Bones).*[Aa]sk Dave to join the call/.exec(transcript);
      if (join) return doJoinBoss();

      const question = /[Hh]ey.*(bones|Barnes|Bones).*[Aa]sk Dave(\s+|.?)(.*)$/.exec(transcript);
      if (question) return doQuestion(question[3]);
    
      const repeat = /[Hh]ey.*(bones|Barnes|Bones).*(repeat that|say that again)/.exec(transcript);
      if (repeat) return repeatLastResponse();
    }
  } catch (err) {
    console.log(err, `Error parsing message ${data}`);
  }
}

/* use jambonz live call control to inject audio into the call */
const doSay = (text) => {
  const sayOpts = {
    method: 'post',
    url: `${process.env.JAMBONZ_BASE_URL}v1/Accounts/${process.env.JAMBONZ_ACCOUNT_SID}/Calls/${callSid}`,
    auth: {
      bearer: process.env.JAMBONZ_API_TOKEN
    },
    json: true,
    body: {
      whisper: [
        {
          verb: 'say',
          text
        }
      ]
    }
  };
  request(sayOpts, (err, res, body) => {
    if (err) {
      console.log(err, 'Failed to perform live call control');
      throw err;
    }
    console.log(`response to live call control whisper ${res.statusCode}`);
  });
};

/**
 * Affirm the question we are going to relay, then send it via SMS
 * @param {*} question 
 */
const doQuestion = (question) => {
  doSay(`Sure, I will ask ${process.env.BOSS_NAME}: ${question}`);

  /* send SMS */
  const smsOpts = {
    method: 'post',
    url: `${process.env.JAMBONZ_BASE_URL}v1/Accounts/${process.env.JAMBONZ_ACCOUNT_SID}/Messages`,
    auth: {
      bearer: process.env.JAMBONZ_API_TOKEN
    },
    json: true,
    body: {
      from: process.env.JAMBONZ_CALLING_NUMBER,
      to: process.env.BOSS_PHONE_NUMBER,
      text: `Hey Boss, the folks asked: ${question}`,
      provider: process.env.JAMBONZ_MESSAGING_PARTNER
    }
  };
  request(smsOpts, (err, res, body) => {
    if (err) {
      console.log(err, 'Failed to send SMS');
      throw err;
    }
    console.log(`response to whisper ${res.statusCode}, body: ${JSON.stringify(body)}`);
  });
};

const repeatLastResponse = () => {
  doSay(`Sure.  ${process.env.BOSS_NAME} said:${lastResponse}`);
}

const dialIntoMeeting = (boss) => {
  const opts = {
    method: 'post',
    url: `${process.env.JAMBONZ_BASE_URL}v1/Accounts/${process.env.JAMBONZ_ACCOUNT_SID}/Calls`,
    auth: {
      bearer: process.env.JAMBONZ_API_TOKEN
    },
    json: true,
    body: {
      application_sid: boss ? process.env.JAMBONZ_BOSS_APPLICATION_SID : process.env.JAMBONZ_APPLICATION_SID,
      from: process.env.JAMBONZ_CALLING_NUMBER,
      to: {
        type: 'phone',
        number: process.env.JAMBONZ_CALLED_NUMBER
      },
      tag: {
        meetingPin: process.env.JAMBONZ_MEETING_PIN,
        boss
      }
    }
  };

  request(opts, (err, res, body) => {
    if (err) {
      console.log(err, 'Failed to connect to conference bridge');
      throw err;
    }

    if (!boss) {
      callSid = body.sid;
      console.log(`successfully created new call with callSid: ${body.sid}`);  
    }
    else {
      console.log(`successfully created new call for boss with callSid: ${body.sid}`);  
    }
  });
};

const doJoinBoss = () => {
  joinRequested = true;
  doSay(`Sure, I will check to see if ${process.env.BOSS_NAME} can join the call`);
  /* send SMS */
  const smsOpts = {
    method: 'post',
    url: `${process.env.JAMBONZ_BASE_URL}v1/Accounts/${process.env.JAMBONZ_ACCOUNT_SID}/Messages`,
    auth: {
      bearer: process.env.JAMBONZ_API_TOKEN
    },
    json: true,
    body: {
      from: process.env.JAMBONZ_CALLING_NUMBER,
      to: process.env.BOSS_PHONE_NUMBER,
      text: `Hey Boss, the folks asked if you could join.
Text Y to join or N to decline.

You can also text a longer reason why you can't join and I'll announce it to the folks`,
      provider: process.env.JAMBONZ_MESSAGING_PARTNER
    }
  };
  request(smsOpts, (err, res, body) => {
    if (err) {
      console.log(err, 'Failed to send SMS');
      throw err;
    }
    console.log(`response to whisper ${res.statusCode}, body: ${JSON.stringify(body)}`);
  });  
};

app.use(express.json());
app.post('/sms', (req, res) => {
  console.log(`'got incoming sms: ${JSON.stringify(req.body)}`);
  res.sendStatus(200);
  if (joinRequested) {
    joinRequested = false;
    if ('N' === req.body.text) {
      doSay(`Sorry, ${process.env.BOSS_NAME} can't join the call right now`);
    }
    else if ('Y' === req.body.text) {
      doSay(`OK, I am connecting ${process.env.BOSS_NAME} to the call now`);
      dialIntoMeeting(process.env.BOSS_PHONE_NUMBER);
    }
    else {
      doSay(`So ${process.env.BOSS_NAME} can't join the call right now.  He said: ${req.body.text}`);
    }
  }
  else {
    lastResponse = req.body.text;
    doSay(`So ${process.env.BOSS_NAME} said: ${lastResponse}`);  
  }
});

console.log('Listening on port 3000');
server.listen(3000);
