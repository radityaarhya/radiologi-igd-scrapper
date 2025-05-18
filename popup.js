document.addEventListener("DOMContentLoaded", function () {
  // Reference to the scrape button
  const scrapeButton = document.getElementById("scrapeButton");

  // Variable to track extraction status
  let isExtracting = false;

  // Set tanggal hari ini sebagai default
  const today = new Date();
  const formattedDate = today.toISOString().split("T")[0];
  document.getElementById("tanggal").value = formattedDate;

  scrapeButton.addEventListener("click", function () {
    // If currently extracting, cancel the operation
    if (isExtracting) {
      isExtracting = false;
      resetButtonAndStatus();
      showStatus("Ekstraksi data dibatalkan.", "info");
      return;
    }

    const tanggal = document.getElementById("tanggal").value;
    if (!tanggal) {
      showStatus("Silakan pilih tanggal terlebih dahulu!", "error");
      return;
    }

    // Set extraction state to true
    isExtracting = true;

    // Change button text to "Cancel"
    scrapeButton.textContent = "Cancel";
    scrapeButton.classList.add("cancel-button");

    // Show warning to user
    showStatus(
      "PERINGATAN: Jangan refresh halaman atau ubah tab aktif selama ekstraksi data berlangsung!",
      "warning"
    );

    setTimeout(() => {
      if (isExtracting) {
        showStatus("Memproses... Mohon tunggu", "info");
        const baseUrl = `http://apps.rsudntb.id/radiologi/pasien?jenis_cari=norm&katakunci=&ruanganAsal=0&status=0&dpjp=0&expertise=0&daterange=${tanggal}+-+${tanggal}&filter=true`;

        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            const currentTabId = tabs[0].id;

            // Selalu redirect ke halaman dengan tanggal yang benar terlebih dahulu
            chrome.tabs.update(currentTabId, { url: baseUrl }, function () {
              chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === currentTabId && info.status === "complete") {
                  chrome.tabs.onUpdated.removeListener(listener);

                  // Mulai proses scraping setelah halaman pertama dimuat
                  setTimeout(function () {
                    // Check if extraction was cancelled
                    if (!isExtracting) {
                      return;
                    }
                    // Kumpulkan data dari semua halaman
                    collectAllPagesData(currentTabId, tanggal, baseUrl);
                  }, 2000);
                }
              });
            });
          }
        );
      }
    }, 1500);
  });

  // Function to reset button and status
  function resetButtonAndStatus() {
    scrapeButton.textContent = "Ekstrak Data";
    scrapeButton.classList.remove("cancel-button");
    isExtracting = false;
  }

  // Fungsi untuk mengumpulkan data dari semua halaman
  function collectAllPagesData(tabId, tanggal, baseUrl) {
    // Check if extraction was cancelled
    if (!isExtracting) {
      resetButtonAndStatus();
      return;
    }

    // Jalankan script untuk mendeteksi jumlah halaman dan mengambil data halaman pertama
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        function: getFirstPageAndPaginationInfo,
      },
      function (results) {
        // Check if extraction was cancelled
        if (!isExtracting) {
          resetButtonAndStatus();
          return;
        }

        if (chrome.runtime.lastError) {
          showStatus("Error: " + chrome.runtime.lastError.message, "error");
          resetButtonAndStatus();
          return;
        }

        if (results && results[0] && results[0].result) {
          const pageInfo = results[0].result;

          if (!pageInfo.success) {
            showStatus(pageInfo.message, "error");
            resetButtonAndStatus();
            return;
          }

          // Data total yang akan dikumpulkan
          let allData = [...pageInfo.firstPageData];

          // Jika hanya ada satu halaman, langsung proses hasilnya
          if (pageInfo.totalPages <= 1) {
            processDetailPages(allData, tabId, tanggal);
            return;
          }

          showStatus(
            `Mengumpulkan data dari ${pageInfo.totalPages} halaman...`,
            "info"
          );

          // Fungsi untuk mengumpulkan data dari halaman berikutnya secara rekursif
          function getNextPageData(currentPage) {
            // Check if extraction was cancelled
            if (!isExtracting) {
              resetButtonAndStatus();
              return;
            }

            // Jika sudah semua halaman diproses, format dan download hasilnya
            if (currentPage > pageInfo.totalPages) {
              // Kembali ke halaman awal dan proses detail
              chrome.tabs.update(tabId, { url: baseUrl }, function () {
                setTimeout(() => {
                  // Check if extraction was cancelled
                  if (!isExtracting) {
                    resetButtonAndStatus();
                    return;
                  }
                  processDetailPages(allData, tabId, tanggal);
                }, 1000);
              });
              return;
            }

            // Update status
            showStatus(
              `Mengumpulkan halaman ${currentPage} dari ${pageInfo.totalPages}...`,
              "info"
            );

            // Buka halaman berikutnya
            const nextPageUrl = `${baseUrl}&page=${currentPage}`;
            chrome.tabs.update(tabId, { url: nextPageUrl }, function () {
              // Tunggu sampai halaman dimuat
              function checkUrlLoaded() {
                // Check if extraction was cancelled
                if (!isExtracting) {
                  resetButtonAndStatus();
                  return;
                }

                chrome.tabs.get(tabId, function (tab) {
                  // Cek apakah halaman sudah dimuat dengan URL yang benar
                  if (
                    tab.status === "complete" &&
                    tab.url.includes(`page=${currentPage}`)
                  ) {
                    // Halaman sudah dimuat, ambil datanya
                    setTimeout(() => {
                      // Check if extraction was cancelled
                      if (!isExtracting) {
                        resetButtonAndStatus();
                        return;
                      }

                      chrome.scripting.executeScript(
                        {
                          target: { tabId: tabId },
                          function: getPageData,
                        },
                        function (pageResults) {
                          // Check if extraction was cancelled
                          if (!isExtracting) {
                            resetButtonAndStatus();
                            return;
                          }

                          if (
                            pageResults &&
                            pageResults[0] &&
                            pageResults[0].result
                          ) {
                            // Tambahkan data dari halaman ini
                            allData = [...allData, ...pageResults[0].result];

                            // Lanjut ke halaman berikutnya
                            setTimeout(() => {
                              getNextPageData(currentPage + 1);
                            }, 500);
                          } else {
                            // Lanjut ke halaman berikutnya meskipun error
                            console.error(
                              "Error mengambil data dari halaman " + currentPage
                            );
                            setTimeout(() => {
                              getNextPageData(currentPage + 1);
                            }, 500);
                          }
                        }
                      );
                    }, 1500);
                  } else {
                    // Cek lagi setelah beberapa saat
                    setTimeout(checkUrlLoaded, 500);
                  }
                });
              }

              // Mulai cek loading halaman
              setTimeout(checkUrlLoaded, 1000);
            });
          }

          // Mulai dari halaman 2 (halaman 1 sudah diambil datanya)
          getNextPageData(2);
        } else {
          showStatus("Gagal memuat data halaman pertama", "error");
          resetButtonAndStatus();
        }
      }
    );
  }

  // Fungsi untuk memproses halaman detail setiap pasien
  function processDetailPages(data, tabId, tanggal) {
    // Check if extraction was cancelled
    if (!isExtracting) {
      resetButtonAndStatus();
      return;
    }

    if (!data || data.length === 0) {
      showStatus(
        'Tidak ditemukan data dengan tujuan "Radiologi IGD Terpadu"',
        "error"
      );
      resetButtonAndStatus();
      return;
    }

    // Urutkan data berdasarkan waktu
    data.sort((a, b) => a.waktu.localeCompare(b.waktu));

    showStatus(
      `Mengumpulkan data detail untuk ${data.length} pasien...`,
      "info"
    );

    // Proses setiap halaman detail pasien secara berurutan
    let processedCount = 0;

    // Fungsi untuk meproses detail pasien secara rekursif
    function processNextDetail(index) {
      // Check if extraction was cancelled
      if (!isExtracting) {
        resetButtonAndStatus();
        return;
      }

      if (index >= data.length) {
        // Selesai memproses semua detail
        formatAndDownloadData(data, tanggal);
        resetButtonAndStatus();
        return;
      }

      const patient = data[index];
      const detailUrl = `http://apps.rsudntb.id/radiologi/order/${patient.noPelayanan}/detail`;

      // Update status
      showStatus(
        `Mengumpulkan detail pasien ${index + 1} dari ${data.length}...`,
        "info"
      );

      // Buka halaman detail
      chrome.tabs.update(tabId, { url: detailUrl }, function () {
        // Tunggu sampai halaman detail dimuat
        function checkDetailLoaded() {
          // Check if extraction was cancelled
          if (!isExtracting) {
            resetButtonAndStatus();
            return;
          }

          chrome.tabs.get(tabId, function (tab) {
            if (tab.status === "complete" && tab.url.includes(`/detail`)) {
              // Halaman sudah dimuat, ambil konten
              setTimeout(() => {
                // Check if extraction was cancelled
                if (!isExtracting) {
                  resetButtonAndStatus();
                  return;
                }

                chrome.scripting.executeScript(
                  {
                    target: { tabId: tabId },
                    function: getDetailContent,
                  },
                  function (detailResults) {
                    // Check if extraction was cancelled
                    if (!isExtracting) {
                      resetButtonAndStatus();
                      return;
                    }

                    if (
                      detailResults &&
                      detailResults[0] &&
                      detailResults[0].result
                    ) {
                      const result = detailResults[0].result;
                      // Tambahkan konten detail ke data pasien
                      patient.detailContent = result.detailContent.trim();
                      patient.usiaPasien = result.usiaPasien;
                      // Gunakan nama dari halaman detail jika tersedia
                      if (result.namaPasien) {
                        patient.namaDetail = result.namaPasien;
                      }

                      processedCount++;

                      // Lanjut ke pasien berikutnya
                      setTimeout(() => {
                        processNextDetail(index + 1);
                      }, 500);
                    } else {
                      // Tidak ada konten detail, tetap lanjut
                      patient.detailContent = "Tidak ada data detail";
                      patient.usiaPasien = "Usia tidak diketahui";
                      processedCount++;

                      setTimeout(() => {
                        processNextDetail(index + 1);
                      }, 500);
                    }
                  }
                );
              }, 1500);
            } else {
              // Cek lagi setelah beberapa saat
              setTimeout(checkDetailLoaded, 500);
            }
          });
        }

        // Mulai cek loading halaman detail
        setTimeout(checkDetailLoaded, 1000);
      });
    }

    // Mulai dari pasien pertama
    processNextDetail(0);
  }

  // Fungsi untuk memformat dan mengunduh data
  function formatAndDownloadData(data, tanggal) {
    // Format output
    let output = "";
    data.forEach((item, index) => {
      const paddedIndex = String(index + 1).padStart(2, "0");
      output += `PASIEN ${paddedIndex}\n`;
      output += `${item.waktu}\n`;
      output += `${item.noRM}\n`;

      // Tambahkan nama dengan usia
      const namaToUse = item.namaDetail || item.nama;
      const usiaTeks =
        item.usiaPasien !== undefined &&
        item.usiaPasien !== "Usia tidak diketahui"
          ? `/USIA ${item.usiaPasien} TAHUN`
          : "";
      output += `${namaToUse}${usiaTeks}\n`;

      output += `${item.noPelayanan}\n`;
      output += `http://apps.rsudntb.id/radiologi/order/${item.noPelayanan}/detail\n`;

      // Tambahkan konten detail dalam tanda kutip
      if (item.detailContent) {
        output += `"${item.detailContent}"\n`;
      } else {
        output += `"Tidak ada data detail"\n`;
      }

      output += "\n";
    });

    // Download hasil
    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radiologi_igd_terpadu_${tanggal}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(
      `Berhasil mengekstrak ${data.length} data dengan detail!`,
      "success"
    );
  }

  // Fungsi untuk menampilkan status
  function showStatus(message, type) {
    const statusElement = document.getElementById("status");
    statusElement.textContent = message;

    if (type === "error") {
      statusElement.style.backgroundColor = "#f8d7da";
      statusElement.style.color = "#721c24";
    } else if (type === "success") {
      statusElement.style.backgroundColor = "#d4edda";
      statusElement.style.color = "#155724";
    } else if (type === "warning") {
      statusElement.style.backgroundColor = "#fff3cd";
      statusElement.style.color = "#856404";
    } else {
      statusElement.style.backgroundColor = "#f8f9fa";
      statusElement.style.color = "#000";
    }
  }
});

// Fungsi untuk mendapatkan data halaman pertama dan info pagination
function getFirstPageAndPaginationInfo() {
  try {
    // Verifikasi halaman
    if (!window.location.href.includes("apps.rsudntb.id/radiologi/pasien")) {
      return {
        success: false,
        message:
          "Halaman yang salah. Buka halaman Radiologi Pasien terlebih dahulu.",
      };
    }

    // Deteksi jumlah halaman dari pagination
    let totalPages = 1;
    const paginationLinks = document.querySelectorAll(".pagination li a");
    paginationLinks.forEach((link) => {
      const pageNum = parseInt(link.textContent);
      if (!isNaN(pageNum) && pageNum > totalPages) {
        totalPages = pageNum;
      }
    });

    // Ambil data halaman pertama
    const rows = document.querySelectorAll("#tindakan-table tbody tr");
    const firstPageData = [];

    rows.forEach((row) => {
      const tujuanCell = row.querySelector("td:nth-child(3)");
      const tujuanText = tujuanCell ? tujuanCell.textContent.trim() : "";

      if (tujuanText === "Radiologi IGD Terpadu") {
        firstPageData.push({
          waktu: row.querySelector("td:nth-child(2)").textContent.trim(),
          noRM: row.querySelector("td:nth-child(4)").textContent.trim(),
          nama: row.querySelector("td:nth-child(5)").textContent.trim(),
          noPelayanan: row.querySelector("td:nth-child(7)").textContent.trim(),
        });
      }
    });

    return {
      success: true,
      totalPages: totalPages,
      firstPageData: firstPageData,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

// Fungsi untuk mengambil data dari halaman saat ini
function getPageData() {
  try {
    const rows = document.querySelectorAll("#tindakan-table tbody tr");
    const pageData = [];

    rows.forEach((row) => {
      const tujuanCell = row.querySelector("td:nth-child(3)");
      const tujuanText = tujuanCell ? tujuanCell.textContent.trim() : "";

      if (tujuanText === "Radiologi IGD Terpadu") {
        pageData.push({
          waktu: row.querySelector("td:nth-child(2)").textContent.trim(),
          noRM: row.querySelector("td:nth-child(4)").textContent.trim(),
          nama: row.querySelector("td:nth-child(5)").textContent.trim(),
          noPelayanan: row.querySelector("td:nth-child(7)").textContent.trim(),
        });
      }
    });

    return pageData;
  } catch (error) {
    console.error("Error pada fungsi getPageData:", error);
    return [];
  }
}

// Fungsi untuk mengambil konten detail pasien
function getDetailContent() {
  try {
    // Cari elemen dengan class 'note-editable card-block'
    const detailElement = document.querySelector(".note-editable.card-block");

    // Mengambil tanggal lahir pasien dan menghitung usia
    const tanggalLahirElement = document.querySelector("#tgl_lahir_pasien");
    let usiaPasien = "Usia tidak diketahui";

    if (tanggalLahirElement && tanggalLahirElement.value) {
      const tanggalLahirPasien = new Date(tanggalLahirElement.value);
      const currentDate = new Date();

      // Hitung usia dasar (selisih tahun)
      let usia = currentDate.getFullYear() - tanggalLahirPasien.getFullYear();

      // Koreksi jika belum ulang tahun tahun ini
      const birthdayThisYear = new Date(
        currentDate.getFullYear(),
        tanggalLahirPasien.getMonth(),
        tanggalLahirPasien.getDate()
      );

      if (currentDate < birthdayThisYear) {
        usia--;
      }

      usiaPasien = usia;
    }

    // Ambil nama pasien jika ada
    const namaPasienElement = document.querySelector("#nama_pasien");
    const namaPasien = namaPasienElement ? namaPasienElement.value.trim() : "";

    // Ambil data detail
    let detailContent = "Konten detail tidak ditemukan";
    if (detailElement) {
      detailContent = detailElement.textContent.trim();
    }

    // Kembalikan objek dengan semua informasi yang dibutuhkan
    return {
      detailContent: detailContent,
      usiaPasien: usiaPasien,
      namaPasien: namaPasien,
    };
  } catch (error) {
    console.error("Error pada fungsi getDetailContent:", error);
    return {
      detailContent: "Error saat mengambil konten detail",
      usiaPasien: "Error",
      namaPasien: "",
    };
  }
}
