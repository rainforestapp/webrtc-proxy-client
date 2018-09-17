import WebRtcStreamer from './webrtcstreamer';
export default function init({
  elemId,
  videoUrl,
  audioUrl = '',
  options,
  proxyUrl = 'http://webrtc-proxy-001.rnfrst.com:8000',
  onError = (err) => console.log(err),
}) {
  let webrtcServer = new WebRtcStreamer(elemId, proxyUrl);
  webrtcServer.connect(videoUrl, audioUrl, undefined);
  webrtcServer.onError = onError;
  window.onbeforeunload = function() {
    webrtcServer.disconnect();
  };

  return webrtcServer;
}
