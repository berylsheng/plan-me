// The app treats the device clock as NZ time (week ranges use local dates),
// so tests run in NZ time whatever the machine is set to.
module.exports = async () => {
  process.env.TZ = 'Pacific/Auckland';
};
