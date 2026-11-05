import type { RoomConnectionView } from '../roomView';
import type { DataListener, RoomViewListener } from './model';
import { PeerJsRoomClientState } from './PeerJsRoomClientState';

export abstract class PeerJsRoomClientView extends PeerJsRoomClientState {

  public override subscribe(listener: RoomViewListener): () => void {
    this.viewListeners.add(listener);
    listener(this.view);
    return () => this.viewListeners.delete(listener);
  }

  public override subscribeData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public override getView(): RoomConnectionView {
    return this.view;
  }
}
