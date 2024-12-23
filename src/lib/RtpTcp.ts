import { Socket } from 'net';
import { RtspStream } from './Mount';
import { getDebugger } from './utils';

const debug = getDebugger('RtpTcp');

export class RtpTcp {
  stream: RtspStream;
  clientSocket: Socket;
  interleaved: boolean;
  rtpChannel: number;
  rtcpChannel: number;
  private sendQueue: Buffer[];
  private sending: boolean;

  constructor(stream: RtspStream, clientSocket: Socket, rtpChannel: number = 0, rtcpChannel: number = 1) {
    this.stream = stream;
    this.clientSocket = clientSocket;
    this.interleaved = true;
    this.rtpChannel = rtpChannel;
    this.rtcpChannel = rtcpChannel;
    this.sendQueue = [];
    this.sending = false;

    debug('Created RtpTcp handler with channels RTP: %d, RTCP: %d', rtpChannel, rtcpChannel);

    // Handle socket drain event
    this.clientSocket.on('drain', () => {
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.sending || this.sendQueue.length === 0) return;
    this.sending = true;

    while (this.sendQueue.length > 0) {
      const packet = this.sendQueue[0];
      if (!this.clientSocket.write(packet)) {
        // Socket buffer is full, wait for drain
        break;
      }
      this.sendQueue.shift();
    }

    this.sending = false;
  }

  private queuePacket(packet: Buffer, isRtp: boolean) {
    const header = Buffer.alloc(4);
    header.writeUInt8(0x24, 0); // $ character
    header.writeUInt8(isRtp ? this.rtpChannel : this.rtcpChannel, 1);
    header.writeUInt16BE(packet.length, 2);
    
    const fullPacket = Buffer.concat([header, packet]);
    this.sendQueue.push(fullPacket);
    this.processQueue();
  }

  sendInterleavedRtp(buffer: Buffer): void {
    if (!this.interleaved || !this.clientSocket) return;
    debug('Queueing RTP packet over TCP, channel %d, length %d', this.rtpChannel, buffer.length);
    this.queuePacket(buffer, true);
  }

  sendInterleavedRtcp(buffer: Buffer): void {
    if (!this.interleaved || !this.clientSocket) return;
    debug('Queueing RTCP packet over TCP, channel %d, length %d', this.rtcpChannel, buffer.length);
    this.queuePacket(buffer, false);
  }

  close(): void {
    debug('Closing RtpTcp handler');
    if (this.clientSocket) {
      this.clientSocket.end();
    }
  }
}
