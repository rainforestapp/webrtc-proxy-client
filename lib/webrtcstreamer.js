URL = window.URL || window.webkitURL;

const fetchAPI = (url, data) =>
  fetch(url, {
    method: data ? 'POST' : 'GET',
    body: data ? JSON.stringify(data) : undefined
  }).then(resp => {
    if (resp.ok) {
      return resp.json();
    }
    throw new Error('Network response was not ok.');
  });

/**
 * Interface with WebRTC-streamer API
 * @constructor
 * @param {string} videoElement - id of the video element tag
 * @param {string} srvurl -  url of webrtc-streamer (default is current location)
 */
export default function WebRtcStreamer(videoElement, srvurl) {
  this.videoElement = videoElement;
  this.srvurl =
    srvurl ||
    location.protocol +
      '//' +
      window.location.hostname +
      ':' +
      window.location.port;
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

/**
 * Connect a WebRTC Stream to videoElement
 * @param {string} videourl - id of WebRTC video stream
 * @param {string} audiourl - id of WebRTC audio stream
 * @param {string} options -  options of WebRTC call
 * @param {string} stream  -  local stream to send
 */
WebRtcStreamer.prototype.connect = function(
  videourl,
  audiourl,
  options,
  localstream
) {
  this.disconnect();

  // getIceServers is not already received
  if (!this.iceServers) {
    console.log('Get IceServers');
    fetchAPI(this.srvurl + '/api/getIceServers').then(iceServers =>
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
};

/**
 * Disconnect a WebRTC Stream and clear videoElement source
 */
WebRtcStreamer.prototype.disconnect = function() {
  var videoElement = document.getElementById(this.videoElement);
  if (videoElement) {
    videoElement.src = '';
  }
  if (this.pc) {
    fetchAPI(`${this.srvurl}/api/hangup?peerid=${this.pc.peerid}`);
    try {
      this.pc.close();
    } catch (e) {
      console.log('Failure close peer connection:' + e);
    }
    this.pc = null;
    this.dc = null;
  }
};

/*
* GetIceServers callback
*/
WebRtcStreamer.prototype.onReceiveGetIceServers = function(
  iceServers,
  videourl,
  audiourl,
  options,
  stream
) {
  this.iceServers = iceServers;
  this.pcConfig = iceServers || { iceServers: [] };
  try {
    this.pc = this.createPeerConnection();

    var peerid = Math.random();
    this.pc.peerid = peerid;

    var streamer = this;
    var callurl =
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
            fetchAPI(callurl, sessionDescription).then(
              streamer.onReceiveCall.bind(streamer)
            ),
          () => {}
        );
      },
      function(error) {
        alert('Create offer error:' + JSON.stringify(error));
      }
    );
  } catch (e) {
    this.disconnect();
    alert('connect error: ' + e);
  }
};

/*
* create RTCPeerConnection 
*/
WebRtcStreamer.prototype.createPeerConnection = function() {
  console.log(
    'createPeerConnection  config: ' +
      JSON.stringify(this.pcConfig) +
      ' option:' +
      JSON.stringify(this.pcOptions)
  );
  var pc = new RTCPeerConnection(this.pcConfig, this.pcOptions);
  var streamer = this;
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
    console.log('oniceconnectionstatechange  state: ' + pc.iceConnectionState);
    var videoElement = document.getElementById(streamer.videoElement);
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
    console.log('remote datachannel created:' + JSON.stringify(evt));

    evt.channel.onopen = function() {
      console.log('remote datachannel open');
      this.send('remote channel openned');
    };
    evt.channel.onmessage = function(event) {
      console.log('remote datachannel recv:' + JSON.stringify(event.data));
    };
  };

  this.dc = pc.createDataChannel('client_data');
  this.dc.onopen = function() {
    console.log('local datachannel open');
    this.send('local channel openned');
  };
  this.dc.onmessage = function(evt) {
    console.log('local datachannel recv:' + JSON.stringify(evt.data));
  };

  console.log(
    'Created RTCPeerConnnection with config: ' +
      JSON.stringify(this.pcConfig) +
      'option:' +
      JSON.stringify(this.pcOptions)
  );
  return pc;
};

/*
* RTCPeerConnection IceCandidate callback
*/
WebRtcStreamer.prototype.onIceCandidate = function(event) {
  if (event.candidate) {
    if (this.pc.currentRemoteDescription) {
      fetchAPI(
        `${this.srvurl}/api/addIceCandidate?peerid=${this.pc.peerid}`,
        event.candidate
      );
    } else {
      this.earlyCandidates.push(event.candidate);
    }
  } else {
    console.log('End of candidates.');
  }
};

/*
* RTCPeerConnection AddTrack callback
*/
WebRtcStreamer.prototype.onTrack = function(event) {
  console.log('Remote track added:' + JSON.stringify(event));
  var stream;
  if (event.streams) {
    stream = event.streams[0];
  } else {
    stream = event.stream;
  }
  var videoElement = document.getElementById(this.videoElement);
  videoElement.src = URL.createObjectURL(stream);
  videoElement.setAttribute('playsinline', true);
  videoElement.play();
};

/*
* AJAX /call callback
*/
WebRtcStreamer.prototype.onReceiveCall = function(dataJson) {
  var streamer = this;
  console.log('offer: ' + JSON.stringify(dataJson));
  this.pc.setRemoteDescription(
    new RTCSessionDescription(dataJson),
    function() {
      console.log('setRemoteDescription ok');
      while (streamer.earlyCandidates.length) {
        var candidate = streamer.earlyCandidates.shift();
        fetchAPI(
          `${streamer.srvurl}/api/addIceCandidate?peerid=${streamer.pc.peerid}`,
          candidate
        );
      }
      fetchAPI(
        `${streamer.srvurl}/api/getIceCandidate?peerid=${streamer.pc.peerid}`
      ).then(streamer.onReceiveCandidate.bind(streamer));
    },
    function(error) {
      console.log('setRemoteDescription error:' + JSON.stringify(error));
    }
  );
};

/*
* AJAX /getIceCandidate callback
*/
WebRtcStreamer.prototype.onReceiveCandidate = function(dataJson) {
  console.log('candidate: ' + JSON.stringify(dataJson));
  if (dataJson) {
    for (var i = 0; i < dataJson.length; i++) {
      var candidate = new RTCIceCandidate(dataJson[i]);

      console.log('Adding ICE candidate :' + JSON.stringify(candidate));
      this.pc.addIceCandidate(
        candidate,
        function() {
          console.log('addIceCandidate OK');
        },
        function(error) {
          console.log('addIceCandidate error:' + JSON.stringify(error));
        }
      );
    }
  }
};
