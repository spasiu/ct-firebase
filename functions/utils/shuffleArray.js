const axios = require("axios");
const functions = require("firebase-functions");

const RAND_URL = "https://qrng.anu.edu.au/API/jsonI.php?type=uint16&length=";

module.exports = async function (arr) {
  let randomArrayData;
  let randomArray;

  // Get randomized array
  try {
    randomArrayData = await axios(`${RAND_URL}${arr.length}`);
    randomArray = randomArrayData.data.data;
  } catch (e) {
    throw new functions.https.HttpsError(
      "internal",
      "Failed to get random array from source."
    );
  }

  // Set sort order for items
  const shuffledArray = arr
    .map((item, idx) => ({
      ...item,
      customSortOrder: randomArray[idx],
    }))
    .sort(function (a, b) {
      return a.customSortOrder - b.customSortOrder;
    });

  // Remove custom property
  shuffledArray.forEach(function (v) {
    delete v.customSortOrder;
  });

  return shuffledArray;
};
