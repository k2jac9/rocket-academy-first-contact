import { RobotViewport } from './RobotViewport';
export function RoverPreview() {
  return (
    <div className="rover-preview">
      <RobotViewport id="husky" interactive={false} />
    </div>
  );
}
