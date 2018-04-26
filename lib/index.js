import WebRtcStreamer from './webrtcstreamer';
export default function init({
  elemId,
  videoUrl,
  audioUrl = '',
  options,
  proxyUrl = 'http://webrtc-proxy-001.rnfrst.com:8000'
}) {
  let webrtcServer = new WebRtcStreamer(elemId, proxyUrl);
  webrtcServer.connect(videoUrl, audioUrl, undefined);
  setupElement(document.getElementById(elemId), webrtcServer);
  window.onbeforeunload = function() {
    webrtcServer.disconnect();
  };

  return webrtcServer;
}
