require('webrtc-adapter');

import Keyboard from '@novnc/novnc/core/input/keyboard';
import Mouse from '@novnc/novnc/core/input/mouse';
import keysyms from '@novnc/novnc/core/input/keysymdef';
const URL = window.URL || window.webkitURL || require('url').URL;
/*
    Filter out all the mouse move events in between mouse button states.
    e.g if first starts from (10, 20) then hovers to (10, 30), then clicks and drags
    until (10, 40) then the filteredEvents will only keep events:
    1. (10, 20) with button state static
    2. (10, 30) with button state static
    3. (10, 30) with button state dragged
    4. (10, 40) with button state dragged
*/
export function filteredEvents(pendingEvents) {
  let skippedEvs = 0;
  const { currentClick, events: evs } = pendingEvents.reduce(
    ({ currentClick, events }, ev) => {
      let newEvents = events;
      if (ev.isClick) {
        if (!currentClick) {
          newEvents = [...newEvents, ev];
        } else if (currentClick.button !== ev.button) {
          if (skippedEvs) {
            newEvents = [...newEvents, currentClick];
          }
        } else {
          skippedEvs++;
        }

        return {
          currentClick: ev,
          events: newEvents
        };
      }

      return { currentClick, events: [...events, ev] };
    },
    { currentClick: null, events: [] }
  );
  return currentClick ? [...evs, currentClick] : evs;
}

const fetchAPI = (url, data, errorHandler = (err) => console.log(err)) =>
  fetch(url, {
    method: data ? 'POST' : 'GET',
    body: data ? JSON.stringify(data) : undefined
  }).then(resp => {
    if (resp.ok) {
      return resp.json();
    }
    errorHandler('Network response was not ok.');
  }).catch(err => errorHandler(err));

/**
 * Interface with WebRTC-streamer API
 * @constructor
 * @param {string} videoElement - id of the video element tag
 * @param {string} srvurl -  url of webrtc-streamer (default is current location)
 */
export default class WebRtcStreamer {
  constructor(videoElement, srvurl, onError) {
    this.videoElement = videoElement;
    this.srvurl =
      srvurl ||
      location.protocol +
        '//' +
        window.location.hostname +
        ':' +
        window.location.port;
    this.onError = onError;

    this.pc = null;
    this.pcOptions = { optional: [{ DtlsSrtpKeyAgreement: true }] };

    this.mediaConstraints = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    };

    this.iceServers = null;
    this.earlyCandidates = [];
    this.dc = null;
  }

  flushEvents() {
    clearTimeout(this.sendEventTimeout);
    this.sendEventTimeout = setTimeout(this.flushEvents.bind(this), 200);
    const events = filteredEvents(this.pendingEvents);
    this.pendingEvents = [];
    if (!events.length) {
      return;
    }
    const message = JSON.stringify({ events });
    if (!this.isConnected()) {
      return;
    }

    this.send(message);
  }

  onMouseEvent(clickEvent) {
    this.onEvents([
      {
        ...clickEvent,
        isClick: true
      }
    ]);
  }

  onKeyboardEvent({ down, code }) {
    this.onEvents([
      {
        down,
        code,
        isPress: true
      }
    ]);
  }

  onPasteText(text) {
    const events = [];
    for (let i = 0; i < text.length; i++) {
      const codepoint = text.charCodeAt(i);
      if (codepoint) {
        const code = keysyms.lookup(codepoint);
        events.push({ code, down: true, isPress: true });
        events.push({ code, down: false, isPress: true });
      }
    }

    this.onEvents(events);
  }

  onEvents(events) {
    if (!events.length) {
      return;
    }

    this.pendingEvents = [...this.pendingEvents, ...events];
    // respond instantly if events contain a keyboard press, mouse button press or initial event
    if (
      events.findIndex(ev => ev.isPress || ev.button) !== -1 ||
      !this.sendEventTimeout
    ) {
      this.flushEvents();
    }
  }

  /**
   * Connect a WebRTC Stream to videoElement
   * @param {string} videourl - id of WebRTC video stream
   * @param {string} audiourl - id of WebRTC audio stream
   * @param {string} options -  options of WebRTC call
   * @param {string} stream  -  local stream to send
   */
  connect(videourl, audiourl, options, localstream) {
    this.disconnect();

    // getIceServers is not already received
    if (!this.iceServers) {
      console.log('Get IceServers');
      fetchAPI(`${this.srvurl}/api/getIceServers`, undefined, this.onError).then(iceServers =>
        this.onReceiveGetIceServers(
          iceServers,
          videourl,
          audiourl,
          options,
          localstream
        )
      );
    } else {
      this.onGetIceServers(
        this.iceServers,
        videourl,
        audiourl,
        options,
        localstream
      );
    }

    this.setupEvents();
  }

  setupEvents() {
    const elem = document.getElementById(this.videoElement);
    // Mouse button state
    let buttonMask = 0;

    const keyboard = new Keyboard(document);
    keyboard.onkeyevent = (keysym, code, down) => {
      this.onKeyboardEvent({
        down,
        code: keysym
      });
    };

    const mouse = new Mouse(elem);
    mouse.onmousebutton = (x, y, down, bmask) => {
      if (down) {
        buttonMask |= bmask;
      } else {
        buttonMask &= ~bmask;
      }

      const relX = Math.floor(1000 * (x / elem.clientWidth));
      const relY = Math.floor(1000 * (y / elem.clientHeight));

      this.onMouseEvent({ x: relX, y: relY, button: buttonMask });
    };

    mouse.onmousemove = (x, y) => {
      const relX = Math.floor(1000 * (x / elem.clientWidth));
      const relY = Math.floor(1000 * (y / elem.clientHeight));
      this.onMouseEvent({ x: relX, y: relY, button: buttonMask });
    };

    mouse.grab();
    keyboard.grab();
  }

  /**
   * Disconnect a WebRTC Stream and clear videoElement source
   */
  disconnect() {
    const videoElement = document.getElementById(this.videoElement);
    if (videoElement) {
      videoElement.src = '';
    }

    clearTimeout(this.sendEventTimeout);
    this.pendingEvents = [];
    this.sendEventTimeout = null;

    if (this.pc) {
      fetchAPI(`${this.srvurl}/api/hangup?peerid=${this.pc.peerid}`, undefined, this.onError);
      try {
        this.pc.close();
      } catch (e) {}
      this.pc = null;
      this.dc = null;
    }
  }

  isConnected() {
    return !!this.dc;
  }

  send(message) {
    if (!this.dc) {
      this.onError('WebRTC server not connected yet!');
    }

    this.dc.send(message);

    return true;
  }

  /*
  * GetIceServers callback
  */
  onReceiveGetIceServers(iceServers, videourl, audiourl, options, stream) {
    this.iceServers = iceServers;
    this.pcConfig = iceServers || { iceServers: [] };
    try {
      this.pc = this.createPeerConnection();

      const peerid = Math.random();
      this.pc.peerid = peerid;

      const streamer = this;
      let callurl =
        this.srvurl +
        '/api/call?peerid=' +
        peerid +
        '&url=' +
        encodeURIComponent(videourl);
      if (audiourl) {
        callurl += '&audiourl=' + encodeURIComponent(audiourl);
      }
      if (options) {
        callurl += '&options=' + encodeURIComponent(options);
      }

      if (stream) {
        this.pc.addStream(stream);
      }

      // clear early candidates
      this.earlyCandidates.length = 0;

      // create Offer
      this.pc.createOffer(this.mediaConstraints).then(
        function(sessionDescription) {
          console.log('Create offer:' + JSON.stringify(sessionDescription));

          streamer.pc.setLocalDescription(
            sessionDescription,
            () =>
              fetchAPI(callurl, sessionDescription, this.onError).then(
                streamer.onReceiveCall.bind(streamer)
              ),
            () => {}
          );
        },
        function(error) {
          this.onError(`Create offer error: ${JSON.stringify(error)}`);
        }
      );
    } catch (e) {
      this.disconnect();
      this.onError(`connect error: ${e}`);
    }
  }

  /*
  * create RTCPeerConnection
  */
  createPeerConnection() {
    const pc = new RTCPeerConnection(this.pcConfig, this.pcOptions);
    const streamer = this;
    pc.onicecandidate = function(evt) {
      streamer.onIceCandidate.call(streamer, evt);
    };
    if (typeof pc.ontrack != 'undefined') {
      pc.ontrack = function(evt) {
        streamer.onTrack.call(streamer, evt);
      };
    } else {
      pc.onaddstream = function(evt) {
        streamer.onTrack.call(streamer, evt);
      };
    }
    pc.oniceconnectionstatechange = function(evt) {
      const videoElement = document.getElementById(streamer.videoElement);
      if (videoElement) {
        if (pc.iceConnectionState === 'connected') {
          videoElement.style.opacity = '1.0';
        } else if (pc.iceConnectionState === 'disconnected') {
          videoElement.style.opacity = '0.25';
        } else if (
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'closed'
        ) {
          videoElement.style.opacity = '0.5';
        }
      }
    };
    pc.ondatachannel = function(evt) {
      evt.channel.onopen = function() {
        this.send('remote channel openned');
      };
      evt.channel.onmessage = function(event) {};
    };

    this.dc = pc.createDataChannel('client_data');
    this.dc.onopen = function() {
      this.send('local channel openned');
    };
    this.dc.onmessage = function(evt) {};
    return pc;
  }

  /*
  * RTCPeerConnection IceCandidate callback
  */
  onIceCandidate(event) {
    if (event.candidate) {
      if (this.pc.currentRemoteDescription) {
        fetchAPI(
          `${this.srvurl}/api/addIceCandidate?peerid=${this.pc.peerid}`,
          event.candidate,
          this.onError,
        );
      } else {
        this.earlyCandidates.push(event.candidate);
      }
    }
  }

  /*
  * RTCPeerConnection AddTrack callback
  */
  onTrack(event) {
    let stream;
    if (event.streams) {
      stream = event.streams[0];
    } else {
      stream = event.stream;
    }
    const videoElement = document.getElementById(this.videoElement);
    videoElement.src = URL.createObjectURL(stream);
    videoElement.setAttribute('playsinline', true);
    videoElement.play();
  }

  /*
  * AJAX /call callback
  */
  onReceiveCall(dataJson) {
    const streamer = this;
    this.pc.setRemoteDescription(
      new RTCSessionDescription(dataJson),
      function() {
        while (streamer.earlyCandidates.length) {
          const candidate = streamer.earlyCandidates.shift();
          fetchAPI(
            `${streamer.srvurl}/api/addIceCandidate?peerid=${streamer.pc.peerid}`,
            candidate,
            this.onError,
          );
        }
        fetchAPI(
          `${streamer.srvurl}/api/getIceCandidate?peerid=${streamer.pc.peerid}`,
          undefined,
          this.onError,
        ).then(streamer.onReceiveCandidate.bind(streamer));
      },
      function(error) {
        this.onError(`setRemoteDescription error: ${JSON.stringify(error)}`);
      }
    );
  }

  /*
  * AJAX /getIceCandidate callback
  */
  onReceiveCandidate(dataJson) {
    let candidate;
    if (dataJson) {
      for (let i = 0; i < dataJson.length; i++) {
        candidate = new RTCIceCandidate(dataJson[i]);

        this.pc.addIceCandidate(
          candidate,
          function() {},
          function(error) {
            this.onError(`addIceCandidate error: + ${JSON.stringify(error)}`);
          }
        );
      }
    }
  }
}
