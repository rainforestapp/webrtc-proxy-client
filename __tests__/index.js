import setupWebRTCProxy from '../';

describe('webrtc-proxy-client', () => {
  let webrtcServer;
  beforeEach(() => {
    document.body.innerHTML = '<video id="test-video"></video>';
    webrtcServer = setupWebRTCProxy({
      elemId: 'test-video',
      videoUrl: 'test_video_url',
      audioUrl: 'test_audio_url',
      options: {},
      proxyUrl: 'test_proxy_url',
    });
  });

  it('works', () => {

  });
});
