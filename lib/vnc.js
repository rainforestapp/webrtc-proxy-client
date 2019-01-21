
export function getQEMUExtendedKeyEvent(keysym, down, keycode) {
  function getRFBkeycode(xt_scancode) {
      var upperByte = (keycode >> 8);
      var lowerByte = (keycode & 0x00ff);
      if (upperByte === 0xe0 && lowerByte < 0x7f) {
          lowerByte = lowerByte | 0x80;
          return lowerByte;
      }
      return xt_scancode;
  }
  var buff = [];

  buff[0] = 255; // msg-type
  buff[1] = 0; // sub msg-type

  buff[2] = (down >> 8);
  buff[3] = down;

  buff[4] = (keysym >> 24);
  buff[5] = (keysym >> 16);
  buff[6] = (keysym >> 8);
  buff[7] = keysym;

  var RFBkeycode = getRFBkeycode(keycode);

  buff[8] = (RFBkeycode >> 24);
  buff[9] = (RFBkeycode >> 16);
  buff[10] = (RFBkeycode >> 8);
  buff[11] = RFBkeycode;
  return buff;
}

export function getTextKeyEvent(text) {
  buff[0] = 6; // msg-type

  buff[1] = 0; // padding
  buff[2] = 0; // padding
  buff[3] = 0; // padding

  var n = text.length;

  buff[4] = n >> 24;
  buff[5] = n >> 16;
  buff[6] = n >> 8;
  buff[7] = n;

  for (var i = 0; i < n; i++) {
    buff[8 + i] =  text.charCodeAt(i);
  }

  return buff;
}