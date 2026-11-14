"""Independent MCAP, schema, timing, model-hash and image checks for physics episodes."""
import base64
import hashlib
import io
import json
import sys
from collections import Counter

import numpy as np
from PIL import Image
from jsonschema.validators import validator_for
from mcap.reader import NonSeekingReader, make_reader


def verify(path):
    counts, validators, previous = Counter(), {}, -1
    manifest = None
    states, sensors = {}, {}
    with open(path, "rb") as stream:
        reader = make_reader(stream, validate_crcs=True)
        summary = reader.get_summary()
        assert summary and summary.chunk_indexes
        for schema, channel, message in reader.iter_messages():
            assert schema and schema.encoding == "jsonschema" and channel.message_encoding == "json"
            if schema.id not in validators:
                definition = json.loads(schema.data)
                cls = validator_for(definition)
                cls.check_schema(definition)
                validators[schema.id] = cls(definition)
            payload = json.loads(message.data)
            validators[schema.id].validate(payload)
            assert message.log_time >= previous and message.log_time == message.publish_time
            previous = message.log_time
            if manifest and manifest.get('controller'):
                assert message.sequence == counts[channel.topic], 'Per-channel sequence gap'
            counts[channel.topic] += 1
            if channel.topic == "/episode/manifest": manifest = payload
            elif channel.topic.endswith("/state_action"):
                states.setdefault(payload["id"], []).append(payload)
            elif channel.topic.endswith("/camera/rgb_depth"):
                sensors.setdefault(payload["robotId"], []).append(payload)
        assert summary.statistics.message_count == sum(counts.values())
    assert manifest
    assert hashlib.sha256(manifest["modelXml"].encode()).hexdigest() == manifest["modelSha256"]
    if "terrainCanonicalJson" in manifest:
        assert json.loads(manifest["terrainCanonicalJson"]) == manifest["input"]["terrain"]
        assert hashlib.sha256(manifest["terrainCanonicalJson"].encode()).hexdigest() == manifest["terrainSha256"]
    assert len(manifest["input"]["terrain"]["heights"]) == 4225
    ids = {robot["id"] for robot in manifest["robotModels"]}
    assert set(states) == set(sensors) == ids and len(ids) == 2
    camera = manifest["camera"]
    for rid in ids:
        model = next(r for r in manifest["robotModels"] if r["id"] == rid)
        times = [state["elapsedS"] for state in states[rid]]
        assert times[0] == 0 and times[-1] == manifest["durationS"]
        assert all(a < b for a,b in zip(times,times[1:]))
        assert all(abs(b-a-.1) < 1e-6 for a,b in zip(times[:-1],times[1:-1]))
        for state in states[rid]:
            assert len(state["action"]) == len(state["jointPosition"]) == len(state["jointVelocity"]) == model["wheels"]
            assert abs(np.linalg.norm(state["orientationWxyz"])-1) < 1e-6
            assert np.isfinite(state["position"]+state["velocity"]+state["action"]).all()
        sensor_times = [sample["elapsedS"] for sample in sensors[rid]]
        assert sensor_times == [round(i*.5,9) for i in range(len(sensor_times))]
        for sample in sensors[rid]:
            image = Image.open(io.BytesIO(base64.b64decode(sample["rgbPngBase64"], validate=True)))
            image.load()
            assert image.size == (camera["width"],camera["height"]) and image.mode == "RGB"
            depth = np.frombuffer(base64.b64decode(sample["depthF32LEBase64"], validate=True),dtype="<f4")
            assert depth.size == camera["width"]*camera["height"] and np.isfinite(depth).all() and (depth>0).all()
    assert sum(map(len,sensors.values())) == manifest["sensorSamples"]
    with open(path, "rb") as stream:
        assert sum(1 for _ in NonSeekingReader(stream, validate_crcs=True).iter_messages(log_time_order=False)) == sum(counts.values())
    print(json.dumps(dict(episode=manifest["id"],messages=sum(counts.values()),robots=len(ids),stateFrames=len(next(iter(states.values()))),sensorSamples=sum(map(len,sensors.values())),durationS=manifest["durationS"],checks="indexes, CRCs, schemas, shared clock, model hash, PNG decode, metric depth arrays")))


if __name__ == "__main__": verify(sys.argv[1])
