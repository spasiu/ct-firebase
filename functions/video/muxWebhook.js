const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.muxWebhook = functions.https.onRequest(async (req, res) => {
  // Set stream status
  if (
    req.body.type === "video.live_stream.active" ||
    req.body.type === "video.live_stream.connected" ||
    req.body.type === "video.live_stream.disconnected" ||
    req.body.type === "video.live_stream.idle"
  ) {
    const streamId = req.body.data.id;
    const streamStatus = req.body.type.split(".")[2];

    const matchingStreams = await admin
      .firestore()
      .collection("Breakers")
      .where("muxStreamId", "==", streamId)
      .get();

    matchingStreams.forEach(async (doc) => {
      await admin.firestore().collection("Breakers").doc(doc.id).set(
        {
          streamState: streamStatus,
        },
        { merge: true }
      );
    });
  }

  res.status(200).send("Success");
});
