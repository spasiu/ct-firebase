import axios from "axios";
import functions from "firebase-functions";

const RAND_URL = "https://qrng.anu.edu.au/API/jsonI.php?type=uint16&length=";

module.exports = async function (arr: any[]) {
  let randomArrayData;
  let randomArray: number[];

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
    .map((item: any, idx: number) => ({
      ...item,
      customSortOrder: randomArray[idx],
    }))
    .sort(function (a: { customSortOrder: number; }, b: { customSortOrder: number; }) {
      return a.customSortOrder - b.customSortOrder;
    });

  // Remove custom property
  shuffledArray.forEach(function (v: { customSortOrder: any; }) {
    delete v.customSortOrder;
  });

  return shuffledArray;
};
