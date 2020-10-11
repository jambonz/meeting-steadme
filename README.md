# meeting-steadme

A virtual assistant that attends meetings for you when you are too busy, providing you with:

- a recap of action items assigned during the meeting, provided by symbl.ai
- the ability to text you a question during the meeting if someone needs your immediate input
- the ability to bring you into the meeting if someone asks for you and you agree to join

This solution is built using the open source [jambonz CPaaS](https://docs.jambonz.org) for telephony and SMS features, and [symbl.ai](https://symbl.ai) for conversational intelligence.

## Architecture
![pic](/meeting-steadme.png)

1. meeting-steadme (this app) begins by authenticating to symbl.ai
2. once authenticated, it uses the jambonz [REST API](https://docs.jambonz.org/rest/) to launch an outbound call into the meeting.
3. once that call is answered, it is controlled by a jambonz application that gains entry to the meeting by entering the meeting pin.
4. once in the meeting, the jambonz application begins streaming the conference audio in real-time to a websocket server created by this app, which relays it to the symbl.ai service over their real-time API.
5. once audio is streaming to symbl.ai, we begin getting transcripts.
6. (not pictured) the app evaluates the transcripts and uses the jambonz API to speak audio into the conference and to connect you into the conference if requested and agreed to.

Symbl.ai generates a report at the end of the conference with a distilled set of action items, questions, etc from the meeting.

## jambonz

This app assumes a [jambonz](https://docs.jambonz.org) application has been written to handle the telephony aspects of the call.

The reference implementation used a [Node-RED flow](/jambonz-node-red-flow.json) to implement the jambonz application.

## symbl.ai
You will need a simbl.ai account

## Update .env

First update the .env file with the following:
1. Your App Id that you can get from [Platform](https://platform.symbl.ai)
2. Your App Secret that you can get from [Platform](https://platform.symbl.ai)
3. Your Email Address
4. Your First and Last name
5. The conference DID and PIN
6. jambonz credentials
7. etc

## npm

1. First, run `npm install` to download all the node modules
2. Second, run `node index.js` to start the websocket server

## ngrok

Use ngrok to expose your local endpoint publically so that jambonz can interact with it. You can install ngrok [here](https://ngrok.com/download)

In a new terminal, run `ngrok http 3000` to create a http tunnel to allow the [jambonz listen command](https://docs.jambonz.org/jambonz/#listen) to hit the websocket server. 
