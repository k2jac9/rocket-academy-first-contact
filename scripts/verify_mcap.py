"""Independent readback: Python mcap==1.6.0 and jsonschema, not the TypeScript writer.

Usage: python scripts/verify_mcap.py /path/to/recording.mcap
The checker reads indexes, validates embedded schemas, and makes a second linear
pass to check both chunk CRCs and the complete MCAP data-section CRC.
"""

import json
import math
import sys
from collections import Counter
from importlib.metadata import version

from jsonschema.validators import validator_for
from mcap.reader import NonSeekingReader, make_reader


def rotate(point, quaternion):
    x, y, z = (quaternion[key] for key in ("x", "y", "z"))
    w = quaternion["w"]
    vx, vy, vz = (point[key] for key in ("x", "y", "z"))
    dot = x * vx + y * vy + z * vz
    scale = w * w - x * x - y * y - z * z
    return (
        2 * dot * x + scale * vx + 2 * w * (y * vz - z * vy),
        2 * dot * y + scale * vy + 2 * w * (z * vx - x * vz),
        2 * dot * z + scale * vz + 2 * w * (x * vy - y * vx),
    )


def verify(path):
    counts = Counter()
    validators = {}
    records = []
    with open(path, "rb") as stream:
        reader = make_reader(stream, validate_crcs=True)
        assert reader.get_header().profile == "", "Unexpected middleware profile"
        summary = reader.get_summary()
        assert summary and summary.chunk_indexes, "Missing MCAP chunk index"
        for schema, channel, message in reader.iter_messages():
            assert schema is not None and schema.encoding == "jsonschema"
            assert channel.message_encoding == "json"
            if schema.id not in validators:
                definition = json.loads(schema.data)
                validator_class = validator_for(definition)
                validator_class.check_schema(definition)
                validators[schema.id] = validator_class(definition)
            data = json.loads(message.data)
            validators[schema.id].validate(data)
            assert message.sequence == counts[channel.topic], "Per-channel sequence gap"
            assert message.publish_time == message.log_time
            if records:
                assert message.log_time >= records[-1][2].log_time
            counts[channel.topic] += 1
            records.append((channel.topic, data, message))
        assert summary.statistics.message_count == len(records)
        attachments = {item.name: json.loads(item.data) for item in reader.iter_attachments()}

    metadata = next(data for topic, data, _ in records if topic == "/mission/run")
    result = next(data for topic, data, _ in records if topic == "/mission/result")
    robot_id = metadata["robotId"]
    poses = [(data, message) for topic, data, message in records if topic == f"/robots/{robot_id}/pose"]
    states = [data for topic, data, _ in records if topic == f"/robots/{robot_id}/state"]
    assert len(poses) == len(states) > 0
    assert attachments["mission.json"] == metadata["mission"]
    assert attachments["plan.json"] == metadata["plan"]
    assert metadata["dataClass"] == "synthetic-kinematic"
    assert metadata["seedUsage"] == "unused-deterministic"
    assert metadata["robotProfile"] == {"id": robot_id, "revision": "1.0.0", "model": "kinematic-point-rover", "maxSpeedMps": 2}
    for key in ("physicsValidated", "terrainContactValidated", "imageSensors", "trainingRun"):
        assert metadata["engine"][key] is False
    transform = metadata["referenceFrame"]
    for (pose, message), state in zip(poses, states):
        stamp = pose["timestamp"]
        assert stamp["sec"] * 1_000_000_000 + stamp["nsec"] == message.log_time
        orientation = pose["pose"]["orientation"]
        assert math.isclose(sum(component * component for component in orientation.values()), 1, abs_tol=1e-10)
        rotated = rotate(pose["pose"]["position"], transform["rotationToSource"])
        for axis, delta in zip(("x", "y", "z"), rotated):
            expected = transform["originInSource"][axis] + delta
            assert math.isclose(expected, state["position"][axis], abs_tol=1e-7), "Source/local transform mismatch"
    if result["goalReached"]:
        goal = metadata["mission"]["markers"]["goal"]["position"]
        actual = states[-1]["position"]
        assert math.dist([actual[key] for key in ("x", "y", "z")], [goal[key] for key in ("x", "y", "z")]) <= 0.05

    # The indexed Python reader validates chunks; this pass also covers DataEnd CRC.
    with open(path, "rb") as stream:
        linear_count = sum(1 for _ in NonSeekingReader(stream, validate_crcs=True).iter_messages(log_time_order=False))
    assert linear_count == len(records)
    return {
        "file": path, "python_mcap_version": version("mcap"), "jsonschema_version": version("jsonschema"),
        "messages": len(records), "frames": len(poses), "topics": dict(counts),
        "sourceId": metadata["mission"]["source"]["sourceId"],
        "robotProfile": metadata["robotProfile"],
        "terminalStatus": result["status"], "goalReached": result["goalReached"],
        "schema_validation": "passed", "indexed_readback": "passed", "full_data_crc": "passed",
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/verify_mcap.py recording.mcap")
    print(json.dumps(verify(sys.argv[1]), indent=2))
