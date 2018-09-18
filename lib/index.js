import WebRtcStreamer from './webrtcstreamer';
export default function init({
  elemId,
  videoUrl,
  audioUrl = '',
  options,
  proxyUrl = 'http://webrtc-proxy-001.rnfrst.com:8000',
  onError = (err) => console.log(err),
}) {
  let webrtcServer = new WebRtcStreamer(elemId, proxyUrl, onError);
  webrtcServer.connect(videoUrl, audioUrl, undefined);
  window.onbeforeunload = function() {
    webrtcServer.disconnect();
  };

  return webrtcServer;
}
